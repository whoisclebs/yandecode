import { describe, expect, it } from 'vitest';
import { toFtsQuery } from '../src/persistence/fts-query.js';

describe('toFtsQuery', () => {
  it('quotes tokens, splits camelCase and dedupes', () => {
    expect(toFtsQuery('where is JwtValidator validate?')).toBe(
      '"where" OR "is" OR "jwtvalidator" OR "jwt" OR "validator" OR "validate"',
    );
  });
  it('drops operators and single characters', () => {
    expect(toFtsQuery('a OR b NEAR(x) "quoted" *')).toBe('"or" OR "near" OR "quoted"');
  });
  it('returns null when nothing survives', () => {
    expect(toFtsQuery('?? !! ')).toBeNull();
  });
  it('keeps snake_case tokens whole and adds their parts', () => {
    expect(toFtsQuery('user_id')).toBe('"user_id" OR "user" OR "id"');
  });
});
