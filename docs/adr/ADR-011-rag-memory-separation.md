# ADR-011: Memory is a separate vector index and retriever, never merged into repository RAG

Status: accepted (2026-09-17)

## Context

Part 2 built `HybridRetriever` for one purpose: finding relevant code in the current
repository snapshot. Part 3 adds a second, unrelated corpus — durable cross-session
memories (decisions, patterns, solutions, failures) — that needs its own similarity
search. Both need dense+lexical fusion and MMR diversification; the temptation is to
generalize `HybridRetriever` into one retriever for both.

## Decision

Memory gets its own `VectorIndex` generation (`memory-NNNNN.usearch`, `vector_id_seq`'s
`'memory'` row, both already reserved for this in migration 0001) and its own
`MemoryRetriever`, built by reusing Part 2's low-level fusion primitives directly
(`reciprocalRankFusion`, `maximalMarginalRelevance` from `@yandecode/retrieval`) rather
than by parameterizing or subclassing `HybridRetriever`. `HybridRetriever` itself is
never modified by Part 3 and stays repository-only. `MemoryRetriever` boosts by
confidence and recency instead of `HybridRetriever`'s symbol/test-path boosts — the two
domains rank relevance by genuinely different signals, and a shared abstraction would
need a boost strategy parameter and a namespace-filter parameter bolted onto an
interface that already shipped and passed review in Part 2.

## Alternatives considered

- One generic `Retriever<T>` parameterized over corpus type: fewer files, but couples
  two independently-evolving retrieval domains through a shared interface neither
  actually needs to share, and risks Part 3 changes destabilizing Part 2's
  already-reviewed, already-shipped `HybridRetriever`. Rejected.
- Storing memory embeddings in the SAME `.usearch` file as repository chunks, tagged by
  a type field: one file to manage, but couples the two corpora's generation/rebuild
  lifecycles (a repository re-index would force a memory index rebuild too) and mixes
  two very different vector-id allocation patterns (repository ids are replaced
  wholesale on reindex; memory ids are appended to forever, never wholesale replaced).
  Rejected.

## Consequences

Two independent `.usearch` files, two independent `vector_id_seq` counters, two
independent retrievers sharing only the low-level fusion math. A future memory-quality
improvement (e.g. a different boost formula) cannot regress repository search, and vice
versa.

**Known v0 scope boundary (2026-09-17):** switching the embedding provider (e.g.
toggling `YANDECODE_EMBEDDINGS=hash`, or a future `rag.embeddingModel` config change)
for a workspace that already has stored memories is not supported. `MemoryRepository`
stores each memory's embedding at whatever dimensionality the provider active at write
time produced; there is no re-embedding migration for existing rows. A drift check in
`createSwarmRuntime` rebuilds the on-disk memory index from stored embeddings when its
size doesn't match the `memories` table, but this is a size check only — it does not
detect (and cannot safely recover from) a dimensionality change, since a correct
recovery requires re-embedding every stored memory with the new provider, not just
rebuilding the index shell from already-stored, now-incompatible vectors. Also,
`evidence` is persisted (migration 0005) but not yet surfaced through any MCP-facing
read path (`MemoryHit` doesn't include it), and `MemoryRepository.recordUsage()`/
`archived_at` have no production caller — `memory_feedback` (added the same day as this
note) closes the loop on `confidence` only, not on usage tracking or archival.
