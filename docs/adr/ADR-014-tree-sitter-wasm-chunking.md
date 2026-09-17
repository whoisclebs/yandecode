# ADR-014: Tree-sitter WASM chunking, pinned, with a line-based fallback

Status: accepted (2026-09-16)

## Context

Chunk boundaries should follow syntax (function/class/method) rather than fixed line
windows, for TypeScript, TSX, JavaScript, Python, Go, Java and Rust, without requiring
a native compiler toolchain on the developer's machine.

## Decision

`TreeSitterChunker` uses `web-tree-sitter` **pinned to exactly `0.20.8`** with
`tree-sitter-wasms` **pinned to exactly `0.1.13`**. This combination was verified to
load all seven grammar `.wasm` files (ABI version 14) in this project's Node 22
environment; `web-tree-sitter@0.27.x` fails on the same grammars with a dylink
metadata error, and `@vscode/tree-sitter-wasm` failed to load at all under Node 22.
`ChunkerRouter` falls back to `LineChunker` for unsupported languages, for parse
failures (caught per-file), and for markdown (handled by `MarkdownChunker` instead,
since heading-based sections read better than syntax nodes for prose).

## Alternatives considered

- A native Tree-sitter binding (`tree-sitter` + per-language native modules): faster,
  but requires prebuilt binaries per platform/Node ABI, working against
  `npm install -g` simplicity. Rejected for v0.
- Line-based chunking everywhere: simplest, but ignores function/class boundaries and
  produces worse retrieval units for source code. Kept only as the fallback.

## Consequences

Upgrading `web-tree-sitter` or `tree-sitter-wasms` requires re-verifying grammar
loading before the pin is moved; until then these two versions are exact, not ranged,
in `packages/retrieval/package.json`.
