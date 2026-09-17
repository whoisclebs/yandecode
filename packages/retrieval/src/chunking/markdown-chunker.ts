import type { TokenCounter } from '../embeddings/provider.js';
import type { LineChunker } from './line-chunker.js';
import { DEFAULT_LIMITS, type Chunk, type ChunkLimits, type Chunker } from './types.js';

const HEADING = /^#{1,6}\s+(.*)$/;

export class MarkdownChunker implements Chunker {
  constructor(
    private readonly counter: TokenCounter,
    private readonly line: LineChunker,
    private readonly limits: ChunkLimits = DEFAULT_LIMITS,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async chunk(_path: string, content: string, _language: string | null): Promise<Chunk[]> {
    const lines = content.split('\n');
    const sections: { symbol: string | null; start: number; end: number }[] = [];
    let current = { symbol: null as string | null, start: 0, end: -1 };
    for (let i = 0; i < lines.length; i++) {
      const m = HEADING.exec(lines[i] ?? '');
      if (m) {
        current.end = i - 1;
        if (current.end >= current.start) sections.push(current);
        current = { symbol: m[1]!.trim(), start: i, end: -1 };
      }
    }
    current.end = lines.length - 1;
    if (current.end >= current.start) sections.push(current);

    const out: Chunk[] = [];
    for (const s of sections) {
      const body = lines.slice(s.start, s.end + 1);
      if (body.join('\n').trim().length === 0) continue;
      const tokens = await this.counter.countTokens(body.join('\n'));
      if (tokens <= this.limits.maxTokens) {
        out.push({
          kind: 'section',
          symbol: s.symbol,
          startLine: s.start + 1,
          endLine: s.end + 1,
          content: body.join('\n'),
        });
      } else {
        out.push(...(await this.line.chunkLines(body, s.start + 1, 'section', s.symbol)));
      }
    }
    return out;
  }
}
