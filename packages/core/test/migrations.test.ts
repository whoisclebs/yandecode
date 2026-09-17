import { describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  runMigrations,
  schemaVersion,
} from '../src/persistence/migrations/index.js';
import { openDatabase } from '../src/persistence/open.js';

const EXPECTED_TABLES = [
  'schema_migrations',
  'sessions',
  'events',
  'documents',
  'chunks',
  'vector_index_meta',
  'index_dirty',
  'vector_id_seq',
  'swarms',
  'workspaces',
  'tasks',
  'task_dependencies',
  'task_paths',
  'leases',
  'messages',
  'memories',
  'memory_feedback',
];

describe('migrations', () => {
  it('has strictly increasing versions starting at 1', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it('reports version 0 on an empty database', () => {
    const db = openDatabase(':memory:');
    expect(schemaVersion(db)).toBe(0);
  });

  it('applies all migrations once and is idempotent', () => {
    const db = openDatabase(':memory:');
    const first = runMigrations(db);
    expect(first.applied).toEqual(MIGRATIONS.map((m) => m.version));
    expect(first.current).toBe(SCHEMA_VERSION);
    const second = runMigrations(db);
    expect(second.applied).toEqual([]);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
  });

  it('creates every v0 table and the chunks FTS index', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of EXPECTED_TABLES) expect(names).toContain(t);
    expect(names).toContain('chunks_fts');
    expect(names).toContain('memories_fts');
  });

  it('keeps chunks_fts in sync through triggers', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    db.prepare(
      "INSERT INTO documents (id,path,size_bytes,content_hash,indexed_at,index_generation) VALUES ('d1','src/a.ts',10,'h','2026-01-01T00:00:00.000Z',1)",
    ).run();
    db.prepare(
      "INSERT INTO chunks (id,document_id,vector_id,kind,symbol,identifiers,start_line,end_line,content,content_hash,token_count,created_at,updated_at) VALUES ('c1','d1',1,'function','JwtValidator.validate','jwt validator validate',1,5,'function validate(token) {}','h1',8,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')",
    ).run();
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM chunks_fts WHERE chunks_fts MATCH 'validate'").get(),
    ).toEqual({ c: 1 });
    db.prepare("UPDATE chunks SET content = 'function verify(token) {}' WHERE id = 'c1'").run();
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM chunks_fts WHERE chunks_fts MATCH 'verify'").get(),
    ).toEqual({ c: 1 });
    db.prepare("DELETE FROM documents WHERE id = 'd1'").run();
    expect(db.prepare('SELECT COUNT(*) AS c FROM chunks').get()).toEqual({ c: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM chunks_fts WHERE chunks_fts MATCH 'verify'").get(),
    ).toEqual({ c: 0 });
  });

  it('seeds vector_id_seq for repository and memory', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const rows = db.prepare('SELECT name, next_id FROM vector_id_seq ORDER BY name').all();
    expect(rows).toEqual([
      { name: 'memory', next_id: 1 },
      { name: 'repository', next_id: 1 },
    ]);
  });

  it('migration 0002 adds the chunks.embedding column', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const cols = (db.prepare('PRAGMA table_info(chunks)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('embedding');
  });

  it('migration 0004 adds the memories.embedding column', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const cols = (db.prepare('PRAGMA table_info(memories)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('embedding');
  });

  it('migration 0005 adds the memories.evidence column', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const cols = (db.prepare('PRAGMA table_info(memories)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('evidence');
  });
});
