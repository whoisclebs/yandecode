import type { Database } from '../open.js';
import { up as initial } from './0001-initial.js';
import { up as chunkEmbeddings } from './0002-chunk-embeddings.js';
import { up as swarmMemory } from './0003-swarm-memory.js';
import { up as memoryEmbeddings } from './0004-memory-embeddings.js';

export interface Migration {
  version: number;
  name: string;
  up: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', up: initial },
  { version: 2, name: 'chunk-embeddings', up: chunkEmbeddings },
  { version: 3, name: 'swarm-memory', up: swarmMemory },
  { version: 4, name: 'memory-embeddings', up: memoryEmbeddings },
];

export const SCHEMA_VERSION: number = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export function schemaVersion(db: Database): number {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (!table) return 0;
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as {
    v: number;
  };
  return row.v;
}

export function runMigrations(db: Database): { applied: number[]; current: number } {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const current = schemaVersion(db);
  const applied: number[] = [];
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.up);
      record.run(m.version, m.name, new Date().toISOString());
    })();
    applied.push(m.version);
  }
  return { applied, current: schemaVersion(db) };
}
