import type { TokenCounter } from '../embeddings/provider.js';
import { DEFAULT_LIMITS, type Chunk, type ChunkLimits, type Chunker } from './types.js';

const FRAGMENT_CHARS = 1600;

export class LineChunker implements Chunker {
  constructor(
    private readonly counter: TokenCounter,
    private readonly limits: ChunkLimits = DEFAULT_LIMITS,
  ) {}

  chunk(_path: string, content: string, language: string | null): Promise<Chunk[]> {
    return this.chunkLines(content.split('\n'), 1, language ?? 'text', null);
  }

  async chunkLines(
    lines: string[],
    firstLine: number,
    kind: string,
    symbol: string | null,
  ): Promise<Chunk[]> {
    const tokens = await Promise.all(lines.map((l) => this.counter.countTokens(l)));
    const out: Chunk[] = [];
    let start = 0;
    let current: number[] = [];
    let currentTokens = 0;

    const emit = (indices: number[]): void => {
      if (indices.length === 0) return;
      const text = indices.map((i) => lines[i] ?? '').join('\n');
      if (text.trim().length === 0) return;
      out.push({
        kind,
        symbol,
        startLine: firstLine + indices[0]!,
        endLine: firstLine + indices[indices.length - 1]!,
        content: text,
      });
    };

    for (let i = 0; i < lines.length; i++) {
      const t = tokens[i] ?? 0;
      if (t > this.limits.maxTokens) {
        emit(current);
        current = [];
        currentTokens = 0;
        const line = lines[i] ?? '';
        for (let off = 0; off < line.length; off += FRAGMENT_CHARS) {
          out.push({
            kind: 'fragment',
            symbol,
            startLine: firstLine + i,
            endLine: firstLine + i,
            content: line.slice(off, off + FRAGMENT_CHARS),
          });
        }
        continue;
      }
      if (currentTokens + t > this.limits.targetTokens && current.length > 0) {
        emit(current);
        const overlap: number[] = [];
        let overlapTokens = 0;
        for (let j = current.length - 1; j >= 0; j--) {
          const idx = current[j]!;
          const lt = tokens[idx] ?? 0;
          if (overlapTokens + lt > this.limits.overlapTokens) break;
          overlap.unshift(idx);
          overlapTokens += lt;
        }
        current = overlap;
        currentTokens = overlapTokens;
      }
      current.push(i);
      currentTokens += t;
      start = i;
    }
    emit(current);
    void start;
    return out;
  }
}
