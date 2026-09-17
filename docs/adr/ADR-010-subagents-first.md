# ADR-010: Subagents first; Agent Teams as an optional future backend

Status: accepted (2026-09-16)

## Context

Claude Code Agent Teams exist but remain an experimental, opt-in feature
(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`). v0 has no scheduler or DAG (deferred; see
`yandecode-v0-scope-rag-harness` in project memory) — the dispatcher agent delegates
directly with the native Agent tool.

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

Delegation quality depends on the dispatcher's own judgement and the skills/agent
prompts, not on a deterministic scheduler; that arrives with the swarm work in a later
version.
