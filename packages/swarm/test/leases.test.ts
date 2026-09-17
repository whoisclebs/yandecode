import { describe, expect, it } from 'vitest';
import { leaseConflicts, matchesPattern } from '../src/scheduler/leases.js';

describe('leaseConflicts', () => {
  it('flags identical patterns and nested-directory patterns as conflicting', () => {
    expect(leaseConflicts('src/auth/**', 'src/auth/**')).toBe(true);
    expect(leaseConflicts('src/auth/**', 'src/**')).toBe(true);
    expect(leaseConflicts('src/**', 'src/auth/**')).toBe(true);
  });

  it('does not flag disjoint top-level directories or same-prefix-different-name directories', () => {
    expect(leaseConflicts('src/**', 'test/**')).toBe(false);
    expect(leaseConflicts('src/auth/**', 'src/authorization/**')).toBe(false);
    expect(leaseConflicts('src/a/**', 'src/b/**')).toBe(false);
  });

  it('flags a literal path as conflicting with a wildcard pattern over its own directory', () => {
    expect(leaseConflicts('src/foo.ts', 'src/*.ts')).toBe(true);
  });
});

describe('matchesPattern', () => {
  it('matches a concrete path against a glob pattern', () => {
    expect(matchesPattern('src/auth/login.ts', 'src/auth/**')).toBe(true);
    expect(matchesPattern('src/http/router.ts', 'src/auth/**')).toBe(false);
  });
});
