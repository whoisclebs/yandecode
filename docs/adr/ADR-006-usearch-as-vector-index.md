# ADR-006: USearch as the vector index engine

Status: accepted (2026-09-16)

## Context

Cosine similarity search over a few thousand to a few hundred thousand 384-dimension
vectors needs to run entirely in-process, with no server, and persist to a single file.

## Decision

`usearch`'s Node binding provides an HNSW index (`metric: 'cos'`, `quantization:
'f32'`) wrapped by `VectorIndex`/`USearchVectorIndex`. The index is saved to and loaded
from a single `.usearch` file per generation (ADR-007).

## Alternatives considered

- LanceDB: a fuller retrieval engine (storage + vector search together), but adds a
  second source of truth alongside SQLite; deferred to benchmarks per ADR-003.
- `sqlite-vec` / libSQL vector extensions: would let SQLite hold vectors directly, but
  had a smaller Node ecosystem and less mature HNSW tuning at the time of writing.
  Deferred to benchmarks.

## Consequences

usearch's Node API exposes no way to read a stored vector back by id (`add`, `search`,
`contains`, `remove`, `save`, `load`, `view`, `size`, `capacity` only) — this directly
motivated ADR-007.
