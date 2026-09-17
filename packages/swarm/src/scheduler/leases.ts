import { minimatch } from 'minimatch';

function globBaseSegments(pattern: string): string[] {
  const wildcardIndex = pattern.search(/[*?[{]/);
  const base = wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex);
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  return trimmed.split('/').filter((s) => s.length > 0);
}

export function leaseConflicts(a: string, b: string): boolean {
  if (a === b) return true;
  const segA = globBaseSegments(a);
  const segB = globBaseSegments(b);
  const len = Math.min(segA.length, segB.length);
  for (let i = 0; i < len; i += 1) {
    if (segA[i] !== segB[i]) return false;
  }
  return true;
}

export function matchesPattern(path: string, pattern: string): boolean {
  return minimatch(path, pattern);
}
