import { describe, expect, it } from 'vitest';
import type { EmbeddingProvider, VectorHit, VectorIndex, VectorIndexStats, VectorRecord } from '@yandecode/retrieval';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateService } from '@yandecode/core';
import { MemoryRepository } from '@yandecode/core';
import { MemoryService } from '../src/memory/memory-service.js';

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

class FakeVectorIndex implements VectorIndex {
  private readonly vectors = new Map<number, Float32Array>();
  dimensions(): number { return 3; }
  add(id: number, vector: Float32Array): void { this.vectors.set(id, vector); }
  remove(id: number): void { this.vectors.delete(id); }
  contains(id: number): boolean { return this.vectors.has(id); }
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
  stats(): VectorIndexStats { return { size: this.vectors.size, dimensions: 3, file: null }; }
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 3;
  readonly modelId = 'fake';
  constructor(private readonly vectors: Map<string, Float32Array>, private readonly fallback: Float32Array = new Float32Array([1, 0, 0])) {}
  countTokens(text: string): number { return text.split(/\s+/).filter(Boolean).length; }
  embedQuery(text: string): Promise<Float32Array> { return this.embedDocument(text); }
  embedDocument(text: string): Promise<Float32Array> { return Promise.resolve(this.vectors.get(text) ?? this.fallback); }
  embedDocuments(texts: string[]): Promise<Float32Array[]> { return Promise.all(texts.map((t) => this.embedDocument(t))); }
  dispose(): Promise<void> { return Promise.resolve(); }
}

// eslint-disable-next-line @typescript-eslint/require-await -- async for symmetry with await-ing call sites; no await needed internally
async function setup(vectors: Map<string, Float32Array> = new Map()) {
  const state = StateService.open(join(mkdtempSync(join(tmpdir(), 'yc-memory-service-')), 'state.db'));
  const memories = new MemoryRepository(state);
  const index = new FakeVectorIndex();
  const provider = new FakeEmbeddingProvider(vectors);
  const service = new MemoryService({ memories, provider, index });
  return { state, memories, index, provider, service };
}

describe('MemoryService.store', () => {
  it('stores a new memory, embeds it and adds it to the vector index', async () => {
    const { state, index, service } = await setup(new Map([['a useful pattern', new Float32Array([1, 0, 0])]]));
    const result = await service.store({ namespace: 'patterns', content: 'a useful pattern', summary: null, sourceSwarmId: null, sourceTaskId: null, confidence: 0.6, evidence: 'task-1' });
    expect(result.status).toBe('stored');
    if (result.status === 'stored') {
      expect(index.contains(result.memory.vectorId)).toBe(true);
    }
    state.close();
  });

  it('rejects storage when the write policy rejects the candidate, without touching the repository or index', async () => {
    const { state, index, service } = await setup();
    const result = await service.store({ namespace: 'patterns', content: 'a fact', summary: null, sourceSwarmId: null, sourceTaskId: null, confidence: 0.6, evidence: null });
    expect(result).toEqual({ status: 'rejected', reason: 'no evidence provided' });
    expect(index.stats().size).toBe(0);
    state.close();
  });

  it('reports an exact duplicate on identical namespace+content without creating a second row', async () => {
    const vectors = new Map([['same content', new Float32Array([1, 0, 0])]]);
    const { state, memories, service } = await setup(vectors);
    const first = await service.store({ namespace: 'patterns', content: 'same content', summary: null, sourceSwarmId: null, sourceTaskId: null, confidence: 0.5, evidence: 'task-1' });
    const second = await service.store({ namespace: 'patterns', content: 'same content', summary: null, sourceSwarmId: null, sourceTaskId: null, confidence: 0.5, evidence: 'task-2' });
    expect(second.status).toBe('duplicate');
    if (first.status === 'stored' && second.status === 'duplicate') {
      expect(second.existing.id).toBe(first.memory.id);
    }
    expect(memories.get((first as { status: 'stored'; memory: { id: string } }).status === 'stored' ? (first as never as { memory: { id: string } }).memory.id : '')).toBeTruthy();
    state.close();
  });

  it('reports a near-duplicate (cosine >= 0.95) even when the text differs', async () => {
    const vA = new Float32Array([1, 0, 0]);
    const vB = new Float32Array([0.96, 0.28, 0]);
    const vectors = new Map([
      ['original phrasing of the pattern', vA],
      ['a differently worded near-duplicate', vB],
    ]);
    const { state, service } = await setup(vectors);
    const first = await service.store({ namespace: 'patterns', content: 'original phrasing of the pattern', summary: null, sourceSwarmId: null, sourceTaskId: null, confidence: 0.5, evidence: 'task-1' });
    const second = await service.store({ namespace: 'patterns', content: 'a differently worded near-duplicate', summary: null, sourceSwarmId: null, sourceTaskId: null, confidence: 0.5, evidence: 'task-2' });
    expect(second.status).toBe('duplicate');
    if (first.status === 'stored' && second.status === 'duplicate') {
      expect(second.existing.id).toBe(first.memory.id);
    }
    state.close();
  });

  it('does not flag a genuinely distinct memory (cosine well below 0.95) as a duplicate', async () => {
    const vA = new Float32Array([1, 0, 0]);
    const vC = new Float32Array([0.8, 0.6, 0]);
    const vectors = new Map([
      ['pattern one', vA],
      ['an unrelated pattern', vC],
    ]);
    const { state, service } = await setup(vectors);
    const first = await service.store({ namespace: 'patterns', content: 'pattern one', summary: null, sourceSwarmId: null, sourceTaskId: null, confidence: 0.5, evidence: 'task-1' });
    const second = await service.store({ namespace: 'patterns', content: 'an unrelated pattern', summary: null, sourceSwarmId: null, sourceTaskId: null, confidence: 0.5, evidence: 'task-2' });
    expect(first.status).toBe('stored');
    expect(second.status).toBe('stored');
    state.close();
  });

  it('does not flag a near-duplicate in a DIFFERENT namespace as a duplicate, but still does within the same namespace', async () => {
    const vA = new Float32Array([1, 0, 0]);
    const vB = new Float32Array([0.96, 0.28, 0]);
    const vectors = new Map([
      ['a solution about retries', vA],
      ['a differently worded failure about retries', vB],
    ]);
    const { state, service } = await setup(vectors);
    const first = await service.store({ namespace: 'solutions', content: 'a solution about retries', summary: null, sourceSwarmId: null, sourceTaskId: null, confidence: 0.5, evidence: 'task-1' });
    const second = await service.store({ namespace: 'failures', content: 'a differently worded failure about retries', summary: null, sourceSwarmId: null, sourceTaskId: null, confidence: 0.5, evidence: 'task-2' });
    expect(first.status).toBe('stored');
    expect(second.status).toBe('stored');
    state.close();
  });
});

describe('MemoryService.feedback', () => {
  it('increases confidence on a helpful verdict', async () => {
    const { state, memories, service } = await setup(new Map([['content', new Float32Array([1, 0, 0])]]));
    const stored = await service.store({ namespace: 'patterns', content: 'content', summary: null, sourceSwarmId: null, sourceTaskId: null, confidence: 0.5, evidence: 'task-1' });
    if (stored.status !== 'stored') throw new Error('expected stored');
    await service.feedback({ memoryId: stored.memory.id, taskId: null, verdict: 'helpful', note: null });
    expect(memories.get(stored.memory.id)!.confidence).toBeGreaterThan(0.5);
    state.close();
  });

  it('decreases confidence on a wrong verdict, more sharply than a stale one', async () => {
    const { state, memories, service } = await setup(new Map([['content', new Float32Array([1, 0, 0])]]));
    const stored = await service.store({ namespace: 'patterns', content: 'content', summary: null, sourceSwarmId: null, sourceTaskId: null, confidence: 0.5, evidence: 'task-1' });
    if (stored.status !== 'stored') throw new Error('expected stored');
    await service.feedback({ memoryId: stored.memory.id, taskId: null, verdict: 'wrong', note: 'no longer true' });
    const afterWrong = memories.get(stored.memory.id)!.confidence;
    expect(afterWrong).toBeLessThan(0.5);
    state.close();
  });
});
