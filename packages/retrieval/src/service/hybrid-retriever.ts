import type { ChunkRecord, DocumentRepository } from '@yandecode/core';
import type { EmbeddingProvider } from '../embeddings/provider.js';
import { applyBoosts } from '../fusion/boosts.js';
import { maximalMarginalRelevance } from '../fusion/mmr.js';
import { reciprocalRankFusion } from '../fusion/rrf.js';
import type { VectorIndex } from '../vector/types.js';

export interface RagHit {
  path: string;
  startLine: number;
  endLine: number;
  symbol: string | null;
  score: number;
  content: string;
}

export interface HybridRetrieverConstants {
  denseTopK: number;
  lexicalTopK: number;
  rrfK: number;
  mmrLambda: number;
  maxResults: number;
  tokenBudget: number;
}

export const DEFAULT_RETRIEVER_CONSTANTS: HybridRetrieverConstants = {
  denseTopK: 30,
  lexicalTopK: 30,
  rrfK: 60,
  mmrLambda: 0.7,
  maxResults: 12,
  tokenBudget: 6000,
};

export interface HybridRetrieverDeps {
  documents: DocumentRepository;
  provider: EmbeddingProvider;
  index: VectorIndex;
  constants?: HybridRetrieverConstants;
}

export interface HybridSearchOptions {
  limit: number;
}

export class HybridRetriever {
  private readonly constants: HybridRetrieverConstants;

  constructor(private readonly deps: HybridRetrieverDeps) {
    this.constants = deps.constants ?? DEFAULT_RETRIEVER_CONSTANTS;
  }

  async search(query: string, options: HybridSearchOptions): Promise<RagHit[]> {
    if (this.deps.index.stats().size === 0) return [];

    const queryVector = await this.deps.provider.embedQuery(query);
    const denseHits = this.deps.index.search(queryVector, this.constants.denseTopK);
    const lexicalHits = this.deps.documents.searchLexical(query, this.constants.lexicalTopK);

    const fused = reciprocalRankFusion(
      [denseHits.map((h) => ({ id: h.id })), lexicalHits.map((h) => ({ id: h.vectorId }))],
      this.constants.rrfK,
    );
    if (fused.length === 0) return [];

    const chunks = this.deps.documents.chunksByVectorIds(fused.map((f) => f.id));
    const byVectorId = new Map<number, ChunkRecord>(chunks.map((c) => [c.vectorId, c]));
    const withChunks = fused
      .map((f) => {
        const chunk = byVectorId.get(f.id);
        return chunk ? { id: f.id, score: f.score, symbol: chunk.symbol, path: chunk.path } : null;
      })
      .filter((c): c is { id: number; score: number; symbol: string | null; path: string } => c !== null);

    const boosted = applyBoosts(withChunks, query);
    const embeddings = this.deps.documents.embeddingsByVectorIds(boosted.map((c) => c.id));
    const withVectors = boosted.map((c) => ({ ...c, vector: embeddings.get(c.id) ?? null }));

    const limit = Math.min(options.limit, this.constants.maxResults);
    const selectedIds = maximalMarginalRelevance(queryVector, withVectors, limit, this.constants.mmrLambda);
    const scoreById = new Map(boosted.map((c) => [c.id, c.score]));

    const hits: RagHit[] = [];
    let tokenTotal = 0;
    for (const id of selectedIds) {
      const chunk = byVectorId.get(id);
      if (!chunk) continue;
      if (tokenTotal + chunk.tokenCount > this.constants.tokenBudget && hits.length > 0) break;
      tokenTotal += chunk.tokenCount;
      hits.push({
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        symbol: chunk.symbol,
        score: scoreById.get(id) ?? 0,
        content: chunk.content,
      });
    }
    return hits;
  }
}
