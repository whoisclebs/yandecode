# ADR-003: SQLite as operational source of truth

Status: accepted (2026-09-16)

## Context

YandeCode needs transactional metadata (documents, chunks, sessions, events, index generations) with joins, indexes and full-text search, in a single file, with no server.

## Decision

SQLite (`.yandecode/state.db`) is the source of truth for all structured state. FTS5 provides BM25 lexical retrieval. The vector index is derived state rebuilt from SQLite. Schema changes are versioned migrations recorded in `schema_migrations`; no ad-hoc `CREATE TABLE IF NOT EXISTS` outside migrations.

## Alternatives considered

- LanceDB: excellent for retrieval, but we would still need SQLite for transactions; two stores. Deferred to benchmarks.
- AgentDB: bundles memory and learning we intend to own. Rejected for v0.
- libSQL / sqlite-vec: vector inside SQLite; smaller ecosystem in Node. Deferred to benchmarks.

## Consequences

One file to back up or delete; `doctor` can detect drift between SQLite and the vector index.
