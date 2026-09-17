export function ensureGitignoreEntry(content: string, entry: string): string {
  const lines = content.split(/\r?\n/);
  if (lines.some((l) => l.trim() === entry)) return content.endsWith('\n') || content === '' ? content : `${content}\n`;
  const base = content === '' || content.endsWith('\n') ? content : `${content}\n`;
  return `${base}${entry}\n`;
}

export function removeGitignoreEntry(content: string, entry: string): string {
  const lines = content.split('\n');
  const kept = lines.filter((l) => l.trim() !== entry);
  return kept.join('\n');
}
