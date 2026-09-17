<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <h3 align="center">YandeCode</h3>

  <p align="center">
    A local-first agent harness for Claude Code — hybrid RAG over your repository, disciplined delegation, and lifecycle hooks, without ever leaving Claude Code as the runtime.
    <br />
    <a href="docs/adr"><strong>Explore the architecture decisions »</strong></a>
    <br />
    <br />
    <a href="https://github.com/whoisclebs/yandecode/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/whoisclebs/yandecode/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#what-gets-added-to-your-project">What Gets Added To Your Project</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

YandeCode is **not** a replacement for Claude Code. It is a harness that sits behind it:

```text
Agent = Claude Code + YandeCode Harness
```

Claude Code stays responsible for everything it already owns — model execution, authentication,
conversation, tool calling, permissions. YandeCode never implements a parallel Anthropic client and
never asks for API keys, OAuth tokens, or cookies (see [ADR-001](docs/adr/ADR-001-claude-code-as-execution-runtime.md)).
What YandeCode adds around that runtime:

- **Local hybrid RAG** — lexical (SQLite FTS5 / BM25) and semantic (local embeddings, USearch HNSW)
  search over your repository, fused with Reciprocal Rank Fusion and MMR diversification, served to
  Claude Code through an MCP server.
- **A managed Claude Code plugin** — specialized subagents (dispatcher, scout, implementer, tester,
  reviewer, security, researcher), skills, and lifecycle hooks, materialized into your project by
  `yandecode init` and tracked by a manifest so `uninstall` is exact and repeat `init` runs never
  clobber your edits.
- **Local-first state** — everything lives under `.yandecode/` in your project (SQLite, vector index,
  logs); no hosted services, no external embedding APIs, nothing leaves your machine.

Inspired by [Ruflo](https://github.com/ruvnet/ruflo), `opencode-doppelganger`, and the
`oh-my-clebs-coder` dispatcher/scout pattern — without copying any of them. See
[`docs/adr/`](docs/adr) for the architecture decisions this project has actually made.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![TypeScript][TypeScript-shield]][TypeScript-url]
* [![Node.js][Node-shield]][Node-url]
* [Claude Code](https://code.claude.com/docs) — the execution runtime
* [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — operational state and FTS5 lexical search
* [USearch](https://github.com/unum-cloud/usearch) — HNSW vector index
* [@huggingface/transformers](https://github.com/huggingface/transformers.js) — local embedding inference (`Snowflake/snowflake-arctic-embed-xs`)
* [web-tree-sitter](https://github.com/tree-sitter/tree-sitter) — syntax-aware code chunking
* [Model Context Protocol](https://modelcontextprotocol.io/) — the `rag_search` / `rag_status` tools Claude Code calls

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

### Prerequisites

* Node.js 22 or newer
* [Claude Code](https://code.claude.com/docs/en/setup) installed and authenticated
* Git

### Installation

```bash
npm install -g yandecode
```

or, without a global npm install:

```bash
curl -fsSL https://raw.githubusercontent.com/whoisclebs/yandecode/main/scripts/install.sh | sh
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE EXAMPLES -->
## Usage

```bash
cd your-repository
yandecode init      # adds agents, skills, hooks, MCP server and a CLAUDE.md block
yandecode doctor    # verifies the installation
yandecode index     # builds the local hybrid (lexical + semantic) index
yandecode rag search "where is authentication handled?"
yandecode start      # launches Claude Code with the YandeCode dispatcher agent
```

`yandecode uninstall` removes exactly what `init` added, without touching anything it didn't create
or anything you've edited since; `--purge` also deletes `.yandecode/`.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## What Gets Added To Your Project

- `.claude/agents/yandecode-*.md` — dispatcher, scout, implementer, tester, reviewer, security, researcher
- `.claude/skills/yandecode-*/SKILL.md` — context rules and delegation protocol
- `.claude/settings.json` — `SessionStart`, `PostToolUse`, `SessionEnd` hooks calling `yandecode hook`
- `.mcp.json` — the `yandecode` MCP server (`rag_search`, `rag_status`)
- `CLAUDE.md` — a marked block explaining how to use retrieval
- `.yandecode/` — local state (gitignored); `yandecode.json` — shareable config

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ROADMAP -->
## Roadmap

- [x] **Part 1 — Foundation & Harness**: monorepo, SQLite persistence, the Claude Code plugin
      (agents/skills/hooks), and the CLI (`init`, `uninstall`, `doctor`, `status`, `hook`, `mcp serve`).
- [ ] **Part 2 — Retrieval**: local embeddings, Tree-sitter chunking, the USearch vector index, hybrid
      (lexical + semantic) search, and the `index` / `rag search` / `start` commands.
- [ ] **Part 3 — Swarm, Router & Memory**: task decomposition and a deterministic scheduler, parallel
      worker delegation through Claude Code's native Agent tool (never headless processes — see
      [ADR-010](docs/adr/ADR-010-subagents-first.md)), and a cross-session learning loop so agents
      retain what they learned between sessions.

See the [open issues](https://github.com/whoisclebs/yandecode/issues) for a full list of proposed
features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->
## Contributing

Contributions make open source great. Any contribution you make is **appreciated**.

If you have a suggestion, fork the repo and open a pull request, or open an issue with the tag
"enhancement". Don't forget to star the project if you find it useful!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Development

```bash
npm install
npm test
npm run lint
npm run typecheck
npm run build
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->
## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTACT -->
## Contact

Project Link: [https://github.com/whoisclebs/yandecode](https://github.com/whoisclebs/yandecode)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Ruflo](https://github.com/ruvnet/ruflo) — coordination-pattern inspiration, not a dependency
* [Claude Code](https://code.claude.com/docs) — the runtime YandeCode is built around
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template) — this file's structure

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/whoisclebs/yandecode.svg?style=for-the-badge
[contributors-url]: https://github.com/whoisclebs/yandecode/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/whoisclebs/yandecode.svg?style=for-the-badge
[forks-url]: https://github.com/whoisclebs/yandecode/network/members
[stars-shield]: https://img.shields.io/github/stars/whoisclebs/yandecode.svg?style=for-the-badge
[stars-url]: https://github.com/whoisclebs/yandecode/stargazers
[issues-shield]: https://img.shields.io/github/issues/whoisclebs/yandecode.svg?style=for-the-badge
[issues-url]: https://github.com/whoisclebs/yandecode/issues
[license-shield]: https://img.shields.io/github/license/whoisclebs/yandecode.svg?style=for-the-badge
[license-url]: https://github.com/whoisclebs/yandecode/blob/main/LICENSE
[TypeScript-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Node-shield]: https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white
[Node-url]: https://nodejs.org/
</content>
