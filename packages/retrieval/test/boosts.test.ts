import { describe, expect, it } from 'vitest';
import { applyBoosts } from '../src/fusion/boosts.js';

describe('applyBoosts', () => {
  it('boosts when a query token matches the last segment of the symbol, case-insensitively', () => {
    const out = applyBoosts([{ id: 1, score: 0.5, symbol: 'AuthService.Login', path: 'src/auth.ts' }], 'login flow');
    expect(out[0]?.score).toBeCloseTo(0.55, 10);
  });

  it('boosts test-path candidates when the query mentions test or spec', () => {
    const out = applyBoosts([{ id: 1, score: 0.5, symbol: null, path: 'test/auth.integration.test.ts' }], 'integration test for login');
    expect(out[0]?.score).toBeCloseTo(0.52, 10);
  });

  it('applies both boosts when both conditions hold', () => {
    const out = applyBoosts([{ id: 1, score: 0.5, symbol: 'AuthService.Login', path: 'test/auth.test.ts' }], 'login test');
    expect(out[0]?.score).toBeCloseTo(0.57, 10);
  });

  it('leaves non-matching candidates untouched', () => {
    const input = [{ id: 1, score: 0.5, symbol: 'Foo.bar', path: 'src/foo.ts' }];
    expect(applyBoosts(input, 'unrelated query')).toEqual(input);
  });
});
