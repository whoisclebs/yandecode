# YandeCode

Local-first agent harness for Claude Code: hybrid RAG over your repository, disciplined delegation, and lifecycle hooks. Claude Code stays the runtime; YandeCode sits behind it.

> Status: v0 in progress. Part 1 (foundation and harness) is implemented; retrieval lands in Part 2.

## Requirements

- Node.js 22+
- Claude Code installed and authenticated
- Git

## Quick start

```bash
npm install -g yandecode
cd your-repository
yandecode init      # adds agents, skills, hooks, MCP server and a CLAUDE.md block
yandecode doctor    # verifies the installation
yandecode index     # builds the local hybrid index (Part 2)
yandecode start     # launches Claude Code with the YandeCode dispatcher (Part 2)
```

`yandecode uninstall` removes exactly what `init` added; `--purge` also deletes `.yandecode/`.

## What gets added to your project

- `.claude/agents/yandecode-*.md` — dispatcher, scout, implementer, tester, reviewer, security, researcher
- `.claude/skills/yandecode-*/SKILL.md` — context rules and delegation protocol
- `.claude/settings.json` — `SessionStart`, `PostToolUse`, `SessionEnd` hooks calling `yandecode hook`
- `.mcp.json` — the `yandecode` MCP server (`rag_search`, `rag_status`)
- `CLAUDE.md` — a marked block explaining how to use retrieval
- `.yandecode/` — state (gitignored); `yandecode.json` — shareable config

## Development

```bash
npm install
npm test
npm run lint
npm run typecheck
npm run build
```

Architecture decisions live in `docs/adr/`.
