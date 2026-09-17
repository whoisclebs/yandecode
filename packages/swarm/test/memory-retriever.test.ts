import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  EmbeddingProvider,
  VectorHit,
  VectorIndex,
  VectorIndexStats,
  VectorRecord,
} from '@yandecode/retrieval';
import { MemoryRepository, StateService } from '@yandecode/core';
import { describe, expect, it } from 'vitest';
import {
  applyRecencyConfidenceBoost,
  CONFIDENCE_BOOST_WEIGHT,
  MemoryRetriever,
  RECENCY_BOOST_WEIGHT,
  RECENCY_DECAY_DAYS,
} from '../src/memory/memory-retriever.js';

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

class FakeVectorIndex implements VectorIndex {
  private readonly vectors = new Map<number, Float32Array>();
  dimensions(): number {
    return 3;
  }
  add(id: number, vector: Float32Array): void {
    this.vectors.set(id, vector);
  }
  remove(id: number): void {
    this.vectors.delete(id);
  }
  contains(id: number): boolean {
    return this.vectors.has(id);
  }
  search(vector: Float32Array, limit: number): VectorHit[] {
    const hits = [...this.vectors.entries()].map(([id, v]) => ({ id, score: cosine(vector, v) }));
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }
  save(): void {}
  load(): void {}
  rebuild(records: Iterable<VectorRecord>): void {
    this.vectors.clear();
    for (const r of records) this.vectors.set(r.id, r.vector);
  }
  stats(): VectorIndexStats {
    return { size: this.vectors.size, dimensions: 3, file: null };
  }
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 3;
  readonly modelId = 'fake';
  constructor(private readonly vectors: Map<string, Float32Array>) {}
  countTokens(text: string): number {
    return text.split(/\s+/).filter(Boolean).length;
  }
  embedQuery(text: string): Promise<Float32Array> {
    return this.embedDocument(text);
  }
  embedDocument(text: string): Promise<Float32Array> {
    return Promise.resolve(this.vectors.get(text) ?? new Float32Array([0, 0, 1]));
  }
  embedDocuments(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embedDocument(t)));
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

function setup(vectors: Map<string, Float32Array> = new Map()) {
  const state = StateService.open(
    join(mkdtempSync(join(tmpdir(), 'yc-memory-retriever-')), 'state.db'),
  );
  const memories = new MemoryRepository(state);
  const index = new FakeVectorIndex();
  const provider = new FakeEmbeddingProvider(vectors);
  return {
    state,
    memories,
    index,
    provider,
    retriever: new MemoryRetriever({ memories, provider, index }),
  };
}

describe('MemoryRetriever.search', () => {
  it('returns [] immediately when the vector index is empty', async () => {
    const { state, retriever } = setup();
    expect(await retriever.search('anything')).toEqual([]);
    state.close();
  });

  it('fuses dense and lexical hits and returns the best-matching memory first', async () => {
    const vA = new Float32Array([1, 0, 0]);
    const vB = new Float32Array([0, 1, 0]);
    const vectors = new Map([
      ['retry backoff', vA],
      ['deploy timeout', vB],
      ['retry backoff query', vA],
    ]);
    const { state, memories, index, retriever } = setup(vectors);
    const a = await memories.create({
      namespace: 'patterns',
      content: 'retry backoff',
      summary: 'retry pattern',
      sourceSwarmId: null,
      sourceTaskId: null,
      confidence: 0.5,
      contentHash: 'a',
      embedding: vA,
    });
    const b = await memories.create({
      namespace: 'failures',
      content: 'deploy timeout',
      summary: 'deploy failure',
      sourceSwarmId: null,
      sourceTaskId: null,
      confidence: 0.5,
      contentHash: 'b',
      embedding: vB,
    });
    index.add(a.vectorId, vA);
    index.add(b.vectorId, vB);

    const hits = await retriever.search('retry backoff query');
    expect(hits[0]?.id).toBe(a.id);
    void b;
    state.close();
  });

  it('filters out dense-matched memories outside the requested namespace', async () => {
    const shared = new Float32Array([1, 0, 0]);
    const vectors = new Map([
      ['a pattern about retries', shared],
      ['a failure about retries', shared],
    ]);
    const { state, memories, index, retriever } = setup(vectors);
    const pattern = await memories.create({
      namespace: 'patterns',
      content: 'a pattern about retries',
      summary: null,
      sourceSwarmId: null,
      sourceTaskId: null,
      confidence: 0.5,
      contentHash: 'p',
      embedding: shared,
    });
    const failure = await memories.create({
      namespace: 'failures',
      content: 'a failure about retries',
      summary: null,
      sourceSwarmId: null,
      sourceTaskId: null,
      confidence: 0.5,
      contentHash: 'f',
      embedding: shared,
    });
    index.add(pattern.vectorId, shared);
    index.add(failure.vectorId, shared);

    const hits = await retriever.search('retries', { namespace: 'patterns' });
    expect(hits.map((h) => h.id)).toEqual([pattern.id]);
    state.close();
  });

  it('respects the limit option', async () => {
    const vectors = new Map([
      ['one', new Float32Array([1, 0, 0])],
      ['two', new Float32Array([0, 1, 0])],
      ['three', new Float32Array([0, 0, 1])],
    ]);
    const { state, memories, index, retriever } = setup(vectors);
    for (const [content, vec] of vectors) {
      const rec = await memories.create({
        namespace: 'patterns',
        content,
        summary: null,
        sourceSwarmId: null,
        sourceTaskId: null,
        confidence: 0.5,
        contentHash: content,
        embedding: vec,
      });
      index.add(rec.vectorId, vec);
    }
    const hits = await retriever.search('one', { limit: 1 });
    expect(hits).toHaveLength(1);
    state.close();
  });
});

describe('applyRecencyConfidenceBoost', () => {
  it('adds confidence * CONFIDENCE_BOOST_WEIGHT plus a full recency boost for a just-updated memory', () => {
    const now = Date.now();
    const [boosted] = applyRecencyConfidenceBoost(
      [{ id: 1, score: 0.5, confidence: 1, updatedAt: new Date(now).toISOString() }],
      now,
    );
    expect(boosted!.score).toBeCloseTo(
      0.5 + 1 * CONFIDENCE_BOOST_WEIGHT + 1 * RECENCY_BOOST_WEIGHT,
      10,
    );
  });

  it('decays the recency boost linearly to zero at RECENCY_DECAY_DAYS and floors at zero beyond it', () => {
    const now = Date.now();
    const halfway = new Date(now - (RECENCY_DECAY_DAYS / 2) * 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(now - RECENCY_DECAY_DAYS * 3 * 24 * 60 * 60 * 1000).toISOString();
    const [halfBoosted] = applyRecencyConfidenceBoost(
      [{ id: 1, score: 0, confidence: 0, updatedAt: halfway }],
      now,
    );
    const [oldBoosted] = applyRecencyConfidenceBoost(
      [{ id: 2, score: 0, confidence: 0, updatedAt: old }],
      now,
    );
    expect(halfBoosted!.score).toBeCloseTo(0.5 * RECENCY_BOOST_WEIGHT, 10);
    expect(oldBoosted!.score).toBe(0);
  });
});
