# ADR-002: Local-first architecture

Status: accepted (2026-09-16)

## Context

The harness runs on a developer machine next to a repository. Retrieval must work offline and must not ship source code anywhere.

## Decision

All state lives under `.yandecode/` in the project (SQLite, vector index, logs, cache) and the embedding model runs locally via ONNX. No Docker, PostgreSQL, Redis, cloud vector databases or external embedding APIs. External telemetry is off and does not exist in v0.

## Alternatives considered

- Hosted vector database or embedding API: better throughput, but source leaves the machine and requires network. Rejected.

## Consequences

Single-machine scale only; installation is `npm install -g yandecode`; benchmarks run on the developer's hardware.
