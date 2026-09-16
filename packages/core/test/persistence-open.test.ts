import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/persistence/open.js';

describe('openDatabase', () => {
  it('applies WAL, foreign_keys, busy_timeout and synchronous pragmas on a file db', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'yc-db-')), 'state.db');
    const db = openDatabase(file);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('synchronous', { simple: true })).toBe(1);
    db.close();
  });

  it('verifies FTS5 availability', () => {
    const db = openDatabase(':memory:');
    expect(() => db.exec('CREATE VIRTUAL TABLE probe USING fts5(x)')).not.toThrow();
    db.close();
  });
});
