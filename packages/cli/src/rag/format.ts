import type { RagHit } from '@yandecode/retrieval';

export function formatRagResults(query: string, hits: RagHit[]): string {
  if (hits.length === 0) return `No results for "${query}"\n`;
  const lines: string[] = [];
  for (const hit of hits) {
    lines.push(`${hit.path}:${hit.startLine}-${hit.endLine} [${hit.symbol ?? '-'}] score=${hit.score.toFixed(3)}`);
    lines.push(hit.content.split('\n').slice(0, 3).join('\n'));
    lines.push('');
  }
  return lines.join('\n');
}
