import { describe, expect, it } from 'vitest';
import { newId, nowIso } from '../src/ids.js';

describe('ids', () => {
  it('generates 26-char Crockford base32 ULIDs that sort by time', () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(b >= a).toBe(true);
  });

  it('nowIso returns UTC ISO 8601 with milliseconds', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
