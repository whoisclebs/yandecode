import type { RagHit } from '@yandecode/retrieval';
import { describe, expect, it } from 'vitest';
import { formatRagResults } from '../src/rag/format.js';

describe('formatRagResults', () => {
  it('prints a message when there are no hits', () => {
    expect(formatRagResults('auth', [])).toBe('No results for "auth"\n');
  });

  it('formats each hit with path:range, symbol, score and a 3-line preview', () => {
    const hits: RagHit[] = [
      {
        path: 'src/auth.ts',
        startLine: 10,
        endLine: 20,
        symbol: 'login',
        score: 0.91234,
        content: 'line1\nline2\nline3\nline4',
      },
    ];
    const out = formatRagResults('login', hits);
    expect(out).toContain('src/auth.ts:10-20 [login] score=0.912');
    expect(out).toContain('line1\nline2\nline3');
    expect(out).not.toContain('line4');
  });

  it('shows a dash when there is no symbol', () => {
    const hits: RagHit[] = [
      {
        path: 'README.md',
        startLine: 1,
        endLine: 2,
        symbol: null,
        score: 0.5,
        content: '# Title\ntext',
      },
    ];
    expect(formatRagResults('title', hits)).toContain('README.md:1-2 [-] score=0.500');
  });
});
