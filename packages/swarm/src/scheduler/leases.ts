import { minimatch } from 'minimatch';

function globBaseSegments(pattern: string): string[] {
  const wildcardIndex = pattern.search(/[*?[{]/);
  if (wildcardIndex === -1) {
    const trimmed = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
    return trimmed.split('/').filter((s) => s.length > 0);
  }
  const base = pattern.slice(0, wildcardIndex);
  const lastSlash = base.lastIndexOf('/');
  const complete = lastSlash === -1 ? '' : base.slice(0, lastSlash);
  return complete.split('/').filter((s) => s.length > 0);
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
