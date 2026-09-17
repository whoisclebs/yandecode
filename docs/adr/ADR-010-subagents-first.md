# ADR-010: Subagents first; Agent Teams as an optional future backend

Status: accepted (2026-09-16); superseded in part (2026-09-17) — see the note below.

## Context

Claude Code Agent Teams exist but remain an experimental, opt-in feature
(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`). At the time this ADR was written, v0 had no
scheduler or DAG (deferred; see `yandecode-v0-scope-rag-harness` in project memory) —
the dispatcher agent delegated directly with the native Agent tool.

**Superseded-in-part note (2026-09-17):** the scope-narrowing referenced above was
itself later reopened the same session — v0 now ships the task DAG, deterministic
scheduler, and lease-based conflict detection described in ADR-012. That part of this
ADR's Context/Consequences no longer describes the shipped system. The core Decision
below — subagents via the native Agent tool, never headless `claude -p` processes, no
`AgentExecutionBackend` abstraction — is still accurate and still in force; only the
"no scheduler/DAG" framing is stale.

## Decision

v0 ships seven agents (`yandecode-dispatcher`, `-scout`, `-implementer`, `-tester`,
`-reviewer`, `-security`, `-researcher`) as plain Claude Code subagents, invoked by the
dispatcher through the Agent tool exactly as documented in
`yandecode-workers-follow-ruflo-model` (project memory): spawned in-session, never as
headless `claude -p` processes. `yandecode start` launches `claude --agent
yandecode-dispatcher`. No `AgentExecutionBackend` abstraction ships in v0; introducing
one is out of scope until a second backend (Agent Teams) is actually being built.

## Alternatives considered

- Building the `AgentExecutionBackend` interface now for a currently-nonexistent
  second implementation: speculative, violates YAGNI. Rejected for v0.
- Depending on Agent Teams directly: couples v0 to an experimental, opt-in feature.
  Rejected.

## Consequences

Delegation quality now depends on both the dispatcher's own judgement (informed by the
skills/agent prompts) AND the deterministic scheduler/lease system described in
ADR-012 — the scheduler decides what is safe to run concurrently; the dispatcher still
decides what to decompose and when to stop.
