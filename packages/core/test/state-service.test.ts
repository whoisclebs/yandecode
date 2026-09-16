import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, schemaVersion } from '../src/persistence/migrations/index.js';
import { StateService } from '../src/persistence/state-service.js';

describe('StateService', () => {
  it('opens a file database and applies migrations', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'yc-state-')), 'state.db');
    const state = StateService.open(file);
    expect(schemaVersion(state.db)).toBe(SCHEMA_VERSION);
    expect(state.file).toBe(file);
    state.close();
  });

  it('serializes writes in FIFO order inside transactions', async () => {
    const state = StateService.open(':memory:');
    const order: number[] = [];
    const writes = [1, 2, 3].map((n) =>
      state.write((db) => {
        order.push(n);
        db.prepare("INSERT INTO index_dirty (path, reason, marked_at) VALUES (?, 'test', '2026-01-01T00:00:00.000Z')").run(`f${n}`);
        return n;
      }),
    );
    expect(await Promise.all(writes)).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(state.read((db) => db.prepare('SELECT COUNT(*) AS c FROM index_dirty').get())).toEqual({ c: 3 });
    state.close();
  });

  it('rolls back a failing write and keeps serving later writes', async () => {
    const state = StateService.open(':memory:');
    await expect(
      state.write((db) => {
        db.prepare("INSERT INTO index_dirty (path, reason, marked_at) VALUES ('a', 'x', 'now')").run();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await state.write((db) => db.prepare("INSERT INTO index_dirty (path, reason, marked_at) VALUES ('b', 'x', 'now')").run());
    const rows = state.read((db) => db.prepare('SELECT path FROM index_dirty ORDER BY path').all());
    expect(rows).toEqual([{ path: 'b' }]);
    state.close();
  });
});
