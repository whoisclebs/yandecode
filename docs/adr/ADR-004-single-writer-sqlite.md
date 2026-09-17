# ADR-004: Single-writer SQLite architecture

Status: accepted (2026-09-16)

## Context

SQLite allows many readers but one effective writer. Hooks, the MCP server and CLI commands may run concurrently.

## Decision

Only `@yandecode/core` opens the database. Every write goes through `StateService.write()`, a FIFO promise queue that runs each write in a transaction. WAL mode, `foreign_keys=ON`, `busy_timeout=5000` and `synchronous=NORMAL` are set at open. Separate processes (hook + MCP) rely on WAL and the busy timeout; agents never touch `state.db` directly.

## Alternatives considered

- Letting each module write ad hoc: simpler now, `SQLITE_BUSY` storms later. Rejected.
- A daemon owning the database: adds a process to manage. Rejected for v0.

## Consequences

Writes are serialized in-process; cross-process contention is bounded by the busy timeout; repositories are thin functions over `StateService`.
