import BetterSqlite3 from 'better-sqlite3';
import { YandeCodeError } from '../errors.js';

export type Database = BetterSqlite3.Database;

export function openDatabase(file: string): Database {
  const db = new BetterSqlite3(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  try {
    db.exec('CREATE VIRTUAL TABLE temp.__fts5_probe USING fts5(x); DROP TABLE temp.__fts5_probe;');
  } catch (cause) {
    db.close();
    throw new YandeCodeError('SQLITE_FTS5_MISSING', 'SQLite build lacks FTS5', { cause });
  }
  return db;
}
