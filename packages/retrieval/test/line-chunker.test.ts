import { describe, expect, it } from 'vitest';
import { LineChunker } from '../src/chunking/line-chunker.js';
import { ApproxTokenCounter } from '../src/embeddings/provider.js';

const counter = new ApproxTokenCounter();

describe('LineChunker', () => {
  it('returns one chunk for small content with 1-based lines', async () => {
    const c = new LineChunker(counter);
    const out = await c.chunk('a.txt', 'one\ntwo\nthree', 'text');
    expect(out).toEqual([{ kind: 'text', symbol: null, startLine: 1, endLine: 3, content: 'one\ntwo\nthree' }]);
  });

  it('splits by target tokens with overlapping trailing lines', async () => {
    const c = new LineChunker(counter, { targetTokens: 10, maxTokens: 14, overlapTokens: 4 });
    const lines = Array.from({ length: 12 }, (_, i) => `line${i.toString().padStart(2, '0')}`); // 6 chars = 2 tokens each
    const out = await c.chunk('a.txt', lines.join('\n'), 'text');
    expect(out.length).toBeGreaterThan(1);
    expect(out[0]).toMatchObject({ startLine: 1, endLine: 5 });
    expect(out[1]?.startLine).toBe(4); // 2 lines (4 tokens) of overlap
    expect(out.at(-1)?.endLine).toBe(12);
    for (const ch of out) expect(ch.content.split('\n')).toHaveLength(ch.endLine - ch.startLine + 1);
  });

  it('fragments a single oversized line and drops blank chunks', async () => {
    const c = new LineChunker(counter, { targetTokens: 10, maxTokens: 14, overlapTokens: 4 });
    const huge = 'x'.repeat(4000);
    const out = await c.chunk('min.js', `\n\n${huge}\n\n`, 'javascript');
    expect(out.every((ch) => ch.kind === 'fragment')).toBe(true);
    expect(out.length).toBe(3);
    expect(out[0]?.startLine).toBe(3);
    expect(out.map((ch) => ch.content).join('')).toBe(huge);
  });

  it('chunkLines keeps kind and symbol and offsets line numbers', async () => {
    const c = new LineChunker(counter);
    const out = await c.chunkLines(['a', 'b'], 41, 'method', 'Foo.bar');
    expect(out).toEqual([{ kind: 'method', symbol: 'Foo.bar', startLine: 41, endLine: 42, content: 'a\nb' }]);
  });
});
