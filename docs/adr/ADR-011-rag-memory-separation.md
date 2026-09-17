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
