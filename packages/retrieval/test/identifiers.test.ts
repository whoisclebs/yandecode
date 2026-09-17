import { describe, expect, it } from 'vitest';
import { identifiersOf } from '../src/lexical/identifiers.js';

describe('identifiersOf', () => {
  it('extracts identifiers with their camelCase and snake_case parts, skipping keywords', () => {
    const ids = identifiersOf('export class JwtValidator { validate(token_value) { return this.parseHeader(token_value); } }');
    expect(ids.split(' ')).toEqual(['jwtvalidator', 'jwt', 'validator', 'validate', 'token_value', 'token', 'value', 'parseheader', 'parse', 'header']);
  });
  it('caps at 200 entries', () => {
    const many = Array.from({ length: 500 }, (_, i) => `name${i}`).join(' ');
    expect(identifiersOf(many).split(' ')).toHaveLength(200);
  });
});
