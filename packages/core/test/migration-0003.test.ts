import { openDatabase } from '../src/persistence/open.js';
import { runMigrations, SCHEMA_VERSION } from '../src/persistence/migrations/index.js';
import { describe, expect, it } from 'vitest';

function seedSwarm(db: ReturnType<typeof openDatabase>): string {
  const id = 'swarm-1';
  db.prepare(
    "INSERT INTO swarms (id, title, goal, strategy, status, max_agents, session_id, created_at, updated_at) VALUES (?, 't', 'g', 'adaptive', 'active', 4, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
  ).run(id);
  return id;
}

function seedTask(db: ReturnType<typeof openDatabase>, swarmId: string, id = 'task-1'): string {
  db.prepare(
    "INSERT INTO tasks (id, swarm_id, title, description, role, status, created_at) VALUES (?, ?, 't', 'd', 'implementer', 'planned', '2026-01-01T00:00:00.000Z')",
  ).run(id, swarmId);
  return id;
}

describe('migration 0003 (swarm + memory schema)', () => {
  it('bumps SCHEMA_VERSION to at least 3', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(3);
  });

  it('rejects an invalid swarms.strategy and an invalid tasks.status via CHECK constraints', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    expect(() =>
      db
        .prepare(
          "INSERT INTO swarms (id, title, goal, strategy, status, max_agents, created_at, updated_at) VALUES ('s', 't', 'g', 'not-a-strategy', 'active', 4, 'now', 'now')",
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
    const swarmId = seedSwarm(db);
    expect(() =>
      db
        .prepare(
          "INSERT INTO tasks (id, swarm_id, title, description, role, status, created_at) VALUES ('t1', ?, 't', 'd', 'implementer', 'not-a-status', 'now')",
        )
        .run(swarmId),
    ).toThrow(/CHECK constraint failed/);
  });

  it('cascades deletes: swarm removal removes its tasks, leases, workspaces and messages', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const swarmId = seedSwarm(db);
    const taskId = seedTask(db, swarmId);
    db.prepare(
      "INSERT INTO leases (id, swarm_id, task_id, pattern, holder_agent, acquired_at, expires_at) VALUES ('l1', ?, ?, 'src/**', 'agent-a', 'now', 'later')",
    ).run(swarmId, taskId);
    db.prepare(
      "INSERT INTO workspaces (id, swarm_id, kind, name, path, created_at) VALUES ('w1', ?, 'worktree', 'wt', '/tmp/wt', 'now')",
    ).run(swarmId);
    db.prepare(
      "INSERT INTO messages (id, swarm_id, from_agent, to_agent, type, payload_json, created_at) VALUES ('m1', ?, 'a', 'b', 'finding', '{}', 'now')",
    ).run(swarmId);
    db.prepare("INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)").run(taskId, taskId);
    db.prepare("INSERT INTO task_paths (task_id, pattern) VALUES (?, 'src/**')").run(taskId);

    db.prepare('DELETE FROM swarms WHERE id = ?').run(swarmId);

    for (const table of ['tasks', 'leases', 'workspaces', 'messages', 'task_dependencies', 'task_paths']) {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
      expect(row.c, table).toBe(0);
    }
  });

  it('keeps memories_fts in sync through triggers (insert, update, delete)', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    db.prepare(
      "INSERT INTO memories (id, namespace, content, confidence, content_hash, created_at, updated_at) VALUES ('mem1', 'patterns', 'always validate input at the boundary', 0.5, 'hash1', 'now', 'now')",
    ).run();
    let hit = db.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'validate'").all();
    expect(hit).toHaveLength(1);

    db.prepare("UPDATE memories SET content = 'never trust client input' WHERE id = 'mem1'").run();
    hit = db.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'validate'").all();
    expect(hit).toHaveLength(0);
    hit = db.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'trust'").all();
    expect(hit).toHaveLength(1);

    db.prepare("DELETE FROM memories WHERE id = 'mem1'").run();
    hit = db.prepare("SELECT rowid FROM memories_fts WHERE memories_fts MATCH 'trust'").all();
    expect(hit).toHaveLength(0);
  });

  it('rejects a duplicate memories.content_hash and an invalid memory_feedback.verdict', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    db.prepare(
      "INSERT INTO memories (id, namespace, content, confidence, content_hash, created_at, updated_at) VALUES ('mem1', 'patterns', 'x', 0.5, 'dup-hash', 'now', 'now')",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO memories (id, namespace, content, confidence, content_hash, created_at, updated_at) VALUES ('mem2', 'patterns', 'y', 0.5, 'dup-hash', 'now', 'now')",
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      db
        .prepare("INSERT INTO memory_feedback (id, memory_id, verdict, created_at) VALUES ('f1', 'mem1', 'not-a-verdict', 'now')")
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('deleting a memory cascades to its feedback rows', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    db.prepare(
      "INSERT INTO memories (id, namespace, content, confidence, content_hash, created_at, updated_at) VALUES ('mem1', 'patterns', 'x', 0.5, 'h1', 'now', 'now')",
    ).run();
    db.prepare("INSERT INTO memory_feedback (id, memory_id, verdict, created_at) VALUES ('f1', 'mem1', 'helpful', 'now')").run();
    db.prepare("DELETE FROM memories WHERE id = 'mem1'").run();
    const row = db.prepare('SELECT COUNT(*) AS c FROM memory_feedback').get() as { c: number };
    expect(row.c).toBe(0);
  });
});
