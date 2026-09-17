import type { MemoryNamespace, MemoryRecord, MemoryRepository } from '@yandecode/core';
import { maximalMarginalRelevance, reciprocalRankFusion, type EmbeddingProvider, type VectorIndex } from '@yandecode/retrieval';

export interface MemoryRetrieverConstants {
  denseTopK: number;
  lexicalTopK: number;
  rrfK: number;
  mmrLambda: number;
  maxResults: number;
}

export const DEFAULT_MEMORY_RETRIEVER_CONSTANTS: MemoryRetrieverConstants = {
  denseTopK: 20,
  lexicalTopK: 20,
  rrfK: 60,
  mmrLambda: 0.7,
  maxResults: 6,
};

export const CONFIDENCE_BOOST_WEIGHT = 0.1;
export const RECENCY_BOOST_WEIGHT = 0.05;
export const RECENCY_DECAY_DAYS = 30;

export interface RecencyConfidenceCandidate {
  id: number;
  score: number;
  confidence: number;
  updatedAt: string;
}

function recencyFactor(updatedAt: string, now: number): number {
  const ageDays = (now - new Date(updatedAt).getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(0, 1 - ageDays / RECENCY_DECAY_DAYS);
}

export function applyRecencyConfidenceBoost<T extends RecencyConfidenceCandidate>(candidates: T[], now: number = Date.now()): T[] {
  return candidates.map((c) => ({
    ...c,
    score: c.score + c.confidence * CONFIDENCE_BOOST_WEIGHT + recencyFactor(c.updatedAt, now) * RECENCY_BOOST_WEIGHT,
  }));
}

export interface MemoryHit {
  id: string;
  namespace: MemoryNamespace;
  content: string;
  summary: string | null;
  confidence: number;
  score: number;
}

export interface MemoryRetrieverDeps {
  memories: MemoryRepository;
  provider: EmbeddingProvider;
  index: VectorIndex;
  constants?: MemoryRetrieverConstants;
}

export interface MemorySearchOptions {
  namespace?: MemoryNamespace | null;
  limit?: number;
}

export class MemoryRetriever {
  private readonly constants: MemoryRetrieverConstants;

  constructor(private readonly deps: MemoryRetrieverDeps) {
    this.constants = deps.constants ?? DEFAULT_MEMORY_RETRIEVER_CONSTANTS;
  }

  async search(query: string, options: MemorySearchOptions = {}): Promise<MemoryHit[]> {
    if (this.deps.index.stats().size === 0) return [];
    const namespace = options.namespace ?? null;
    const limit = options.limit ?? this.constants.maxResults;

    const queryVector = await this.deps.provider.embedQuery(query);
    const denseHits = this.deps.index.search(queryVector, this.constants.denseTopK);
    const lexicalHits = this.deps.memories.searchLexical(query, namespace, this.constants.lexicalTopK);

    const fused = reciprocalRankFusion([denseHits.map((h) => ({ id: h.id })), lexicalHits.map((h) => ({ id: h.vectorId }))], this.constants.rrfK);
    if (fused.length === 0) return [];

    const records = this.deps.memories.byVectorIds(fused.map((f) => f.id));
    const byVectorId = new Map<number, MemoryRecord>(records.map((r) => [r.vectorId, r]));
    const withRecords = fused
      .map((f) => {
        const record = byVectorId.get(f.id);
        if (!record) return null;
        if (namespace && record.namespace !== namespace) return null;
        return { id: f.id, score: f.score, confidence: record.confidence, updatedAt: record.updatedAt };
      })
      .filter((c): c is { id: number; score: number; confidence: number; updatedAt: string } => c !== null);
    if (withRecords.length === 0) return [];

    const boosted = applyRecencyConfidenceBoost(withRecords);
    const embeddings = this.deps.memories.embeddingsByVectorIds(boosted.map((c) => c.id));
    const withVectors = boosted.map((c) => ({ ...c, vector: embeddings.get(c.id) ?? null }));

    const selectedIds = maximalMarginalRelevance(queryVector, withVectors, limit, this.constants.mmrLambda);
    const scoreById = new Map(boosted.map((c) => [c.id, c.score]));

    const hits: MemoryHit[] = [];
    for (const id of selectedIds) {
      const record = byVectorId.get(id);
      if (!record) continue;
      hits.push({ id: record.id, namespace: record.namespace, content: record.content, summary: record.summary, confidence: record.confidence, score: scoreById.get(id) ?? 0 });
    }
    return hits;
  }
}
