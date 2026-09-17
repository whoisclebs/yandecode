# ADR-013: better-sqlite3 over node:sqlite

Status: accepted (2026-09-16)

## Context

Node 22 ships an experimental `node:sqlite` module. Both it and `better-sqlite3` were verified locally to provide FTS5 and WAL.

## Decision

Use `better-sqlite3`: mature, synchronous API, stable across Node versions, prebuilt binaries. USearch already requires a native binary, so the marginal installation cost is small.

## Alternatives considered

- `node:sqlite`: zero extra native dependency, but marked experimental and prints an ExperimentalWarning; API may change.
- Abstracting both behind an interface: more code and tests for little value in v0.

## Consequences

One native dependency to diagnose in `doctor`; revisit when `node:sqlite` is stable.
