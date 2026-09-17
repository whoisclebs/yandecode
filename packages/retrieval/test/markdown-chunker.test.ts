import { describe, expect, it } from 'vitest';
import { LineChunker } from '../src/chunking/line-chunker.js';
import { MarkdownChunker } from '../src/chunking/markdown-chunker.js';
import { ApproxTokenCounter } from '../src/embeddings/provider.js';

const counter = new ApproxTokenCounter();

describe('MarkdownChunker', () => {
  it('splits at headings and keeps the heading text as symbol', async () => {
    const md = 'intro line\n\n# Install\n\nnpm i\n\n## Usage\n\nrun it\n### Deep\nmore';
    const out = await new MarkdownChunker(counter, new LineChunker(counter)).chunk('README.md', md, 'markdown');
    expect(out.map((c) => [c.kind, c.symbol, c.startLine, c.endLine])).toEqual([
      ['section', null, 1, 2],
      ['section', 'Install', 3, 6],
      ['section', 'Usage', 7, 9],
      ['section', 'Deep', 10, 11],
    ]);
  });

  it('delegates oversized sections to the line chunker keeping the symbol', async () => {
    const limits = { targetTokens: 10, maxTokens: 14, overlapTokens: 2 };
    const body = Array.from({ length: 20 }, (_, i) => `paragraph ${i}`).join('\n');
    const out = await new MarkdownChunker(counter, new LineChunker(counter, limits), limits).chunk('x.md', `# Big\n${body}`, 'markdown');
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((c) => c.symbol === 'Big' && c.kind === 'section')).toBe(true);
  });
});
