# ADR-008: Hybrid retrieval — FTS5 BM25 plus HNSW cosine search

Status: accepted (2026-09-16)

## Context

Lexical search (exact identifiers, error strings, config keys) and dense search
(paraphrased or conceptual queries) each miss cases the other handles well.

## Decision

Every `rag_search` runs both: `chunks_fts` (FTS5, `bm25(chunks_fts, 1.0, 2.0, 1.5)`
weighting content/symbol/identifiers) and `VectorIndex.search` (HNSW cosine) over the
same chunk set, fused by Reciprocal Rank Fusion (ADR-009), then boosted and diversified
(`fusion/boosts.ts`, `fusion/mmr.ts`) before being cut to a token budget.

## Alternatives considered

- Dense-only retrieval: simpler pipeline, but misses exact-identifier and short
  high-signal queries that hashed/learned embeddings under-weight. Rejected.
- Lexical-only retrieval: fast and precise for exact matches, blind to paraphrase and
  conceptual queries. Rejected.

## Consequences

Every search pays for two lookups instead of one; `HybridRetriever`'s constants
(`denseTopK`, `lexicalTopK` = 30 each) bound that cost regardless of corpus size.
