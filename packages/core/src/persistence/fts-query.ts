const MAX_TOKENS = 32;

export function splitIdentifier(token: string): string[] {
  const parts = token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[_\s]+/)
    .map((p) => p.toLowerCase())
    .filter((p) => p.length >= 2);
  return parts;
}

export function toFtsQuery(query: string): string | null {
  const raw = query.match(/[A-Za-z0-9_]+/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string): void => {
    if (t.length < 2 || seen.has(t) || out.length >= MAX_TOKENS) return;
    seen.add(t);
    out.push(t);
  };
  for (const token of raw) {
    push(token.toLowerCase());
    const parts = splitIdentifier(token);
    if (parts.length > 1) for (const p of parts) push(p);
  }
  if (out.length === 0) return null;
  return out.map((t) => `"${t}"`).join(' OR ');
}
