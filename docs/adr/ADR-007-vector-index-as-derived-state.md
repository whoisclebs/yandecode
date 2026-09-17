# ADR-007: USearch index as derived state, embeddings duplicated in SQLite

Status: accepted (2026-09-16)

## Context

USearch has no `get(id)`. Maximal Marginal Relevance (ADR-009's neighbor, the
diversity pass) needs candidate vectors, and rebuilding the index after a schema or
model change needs every stored embedding — neither is servable from USearch alone.

## Decision

`chunks.embedding` (migration 0002) stores every chunk's embedding as a BLOB in
SQLite, which remains the single source of truth (ADR-003). The `.usearch` file is
derived, disposable state: `IndexingService`'s `rebuild-vectors` mode reconstructs it
from `DocumentRepository.iterateEmbeddings()` without calling the embedding provider
at all. Generations are atomic (`repository-NNNNN.usearch`, written to a temp path and
renamed into place) so a crash mid-rebuild never corrupts the active file.

## Alternatives considered

- Re-embedding on every rebuild: correct, but re-runs the model for content that
  hasn't changed, and doesn't fix a still-broken model/version mismatch. Rejected.
- Storing vectors only in USearch and accepting the missing-`get` limitation: blocks
  MMR and any future re-indexing without a full re-embed. Rejected.

## Consequences

Every chunk write costs one extra BLOB (384 × 4 bytes = 1536 bytes); `doctor`'s
"Repository index" check cross-references SQLite's chunk count and the on-disk
generation against `vector_index_meta` to catch drift.
