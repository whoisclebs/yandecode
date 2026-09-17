# ADR-001: Claude Code as execution runtime

Status: accepted (2026-09-16)

## Context

YandeCode adds retrieval, delegation discipline and lifecycle hooks around an existing coding agent. Implementing model calls, authentication and tool execution ourselves would duplicate Claude Code and require handling credentials.

## Decision

Claude Code is the only runtime. YandeCode never calls the Anthropic API, never asks for API keys, OAuth tokens or cookies, and never bypasses permissions. Workers are Claude Code subagents spawned in-session with the native Agent tool; YandeCode's MCP server and hooks only coordinate and observe. This mirrors the Ruflo rule "MCP coordinates, Claude Code executes".

## Alternatives considered

- Headless `claude -p` worker processes spawned by YandeCode: real process control, but loses interactive permissions and multiplies sessions.
- A custom Anthropic SDK client: full control, duplicated auth and policy surface. Rejected.

## Consequences

YandeCode works wherever Claude Code works, inherits its permission model, and cannot run without it. `yandecode start` is `claude --agent yandecode-dispatcher` plus validation.
