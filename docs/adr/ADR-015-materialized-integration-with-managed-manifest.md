# ADR-015: Materialized integration with managed manifest

Status: accepted (2026-09-16)

## Context

Claude Code discovers agents, skills, hooks and MCP servers from the project's `.claude/` and `.mcp.json`. YandeCode ships that content in `@yandecode/plugin`.

## Decision

`yandecode init` materializes the plugin content into the project (`.claude/agents/yandecode-*.md`, `.claude/skills/yandecode-*/`, hooks merged into `.claude/settings.json`, server added to `.mcp.json`, a marked block in `CLAUDE.md`, `.yandecode/` in `.gitignore`). A manifest at `.yandecode/managed.json` records every managed path with its hash, making `init` idempotent (re-syncs on version change, preserves user edits unless `--force`) and `uninstall` exact (removes only unmodified managed files and marked blocks). A plain `claude` session therefore sees YandeCode without `yandecode start`.

## Alternatives considered

- `claude --plugin-dir` only: nothing copied, but a plain `claude` session sees nothing and the plugin path differs between global and local installs.
- Hybrid (only `.mcp.json` and `CLAUDE.md` materialized): inconsistent experience.

## Consequences

Merge logic must be careful with foreign content; the plugin package stays the single source, and `--plugin-dir` remains available for development.
