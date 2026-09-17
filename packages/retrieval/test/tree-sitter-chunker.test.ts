import { describe, expect, it } from 'vitest';
import { LineChunker } from '../src/chunking/line-chunker.js';
import { createDefaultChunker } from '../src/chunking/router.js';
import { TreeSitterChunker } from '../src/chunking/tree-sitter-chunker.js';
import { ApproxTokenCounter } from '../src/embeddings/provider.js';

const counter = new ApproxTokenCounter();
const ts = `import { x } from './x.js';
import { y } from './y.js';

export interface TokenClaims { sub: string; exp: number }

export class JwtValidator {
  private readonly key: string;
  constructor(key: string) { this.key = key; }

  validate(token: string): TokenClaims {
    return this.parse(token);
  }

  private parse(token: string): TokenClaims {
    return JSON.parse(token) as TokenClaims;
  }
}

export function helper(a: number): number {
  return a + 1;
}

const DEFAULT_TTL = 3600;

describe('JwtValidator', () => {
  it('validates', () => { expect(true).toBe(true); });
});
`;

describe('TreeSitterChunker', () => {
  it('produces one chunk per top-level unit with symbols and 1-based lines', async () => {
    const chunker = new TreeSitterChunker(counter, new LineChunker(counter));
    const out = await chunker.chunk('src/jwt.ts', ts, 'typescript');
    const summary = out.map((c) => [c.kind, c.symbol, c.startLine, c.endLine]);
    expect(summary).toContainEqual(['module', null, 1, 2]);
    expect(summary).toContainEqual(['interface', 'TokenClaims', 4, 4]);
    expect(summary).toContainEqual(['class', 'JwtValidator', 6, 17]);
    expect(summary).toContainEqual(['function', 'helper', 19, 21]);
    expect(summary).toContainEqual(['module', null, 23, 23]);
    expect(summary).toContainEqual(['test', 'JwtValidator', 25, 27]);
    expect(out.find((c) => c.symbol === 'JwtValidator' && c.kind === 'class')?.content).toContain('private parse(');
    expect([...out].sort((a, b) => a.startLine - b.startLine)).toEqual(out);
  });

  it('splits an oversized class into per-method chunks with qualified symbols', async () => {
    const limits = { targetTokens: 30, maxTokens: 40, overlapTokens: 5 };
    const chunker = new TreeSitterChunker(counter, new LineChunker(counter, limits), limits);
    const out = await chunker.chunk('src/jwt.ts', ts, 'typescript');
    const methods = out.filter((c) => c.kind === 'method').map((c) => c.symbol);
    expect(methods).toEqual(expect.arrayContaining(['JwtValidator.constructor', 'JwtValidator.validate', 'JwtValidator.parse']));
    expect(out.some((c) => c.kind === 'class' && c.symbol === 'JwtValidator')).toBe(true);
  });

  it('handles python classes and functions', async () => {
    const py = `import os\n\nclass Auth:\n    def login(self, u):\n        return u\n\n    def logout(self):\n        pass\n\ndef main():\n    Auth().login('a')\n`;
    const chunker = new TreeSitterChunker(counter, new LineChunker(counter));
    const out = await chunker.chunk('auth.py', py, 'python');
    expect(out.map((c) => [c.kind, c.symbol])).toEqual([
      ['module', null],
      ['class', 'Auth'],
      ['function', 'main'],
    ]);
  });

  it('handles go, java and rust top-level units', async () => {
    const chunker = new TreeSitterChunker(counter, new LineChunker(counter));
    const go = await chunker.chunk('a.go', 'package a\n\ntype S struct{}\n\nfunc (s *S) Do() {}\n\nfunc Run() {}\n', 'go');
    expect(go.map((c) => c.symbol)).toEqual(expect.arrayContaining(['S', 'S.Do', 'Run']));
    const java = await chunker.chunk('A.java', 'package p;\n\npublic class A {\n  public void m() {}\n}\n', 'java');
    expect(java.map((c) => [c.kind, c.symbol])).toContainEqual(['class', 'A']);
    const rust = await chunker.chunk('l.rs', 'struct P;\n\nimpl P {\n    fn new() -> P { P }\n}\n\npub fn go() {}\n', 'rust');
    expect(rust.map((c) => c.symbol)).toEqual(expect.arrayContaining(['P', 'go']));
    expect(rust.find((c) => c.kind === 'impl')?.symbol).toBe('P');
  });
});

describe('ChunkerRouter', () => {
  it('routes by language and falls back to lines for unknown languages', async () => {
    const router = createDefaultChunker(counter);
    const md = await router.chunk('README.md', '# T\nbody', 'markdown');
    expect(md[0]?.kind).toBe('section');
    const txt = await router.chunk('notes.txt', 'a\nb', 'text');
    expect(txt[0]?.kind).toBe('text');
    const unknown = await router.chunk('data.bin.txt', 'zzz', null);
    expect(unknown[0]?.kind).toBe('text');
    const code = await router.chunk('x.go', 'package x\nfunc F() {}\n', 'go');
    expect(code.some((c) => c.symbol === 'F')).toBe(true);
  });
});
