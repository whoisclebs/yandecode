import { newId, nowIso } from '../../ids.js';
import type { StateService } from '../state-service.js';

export const LEASE_TTL_MS = 15 * 60 * 1000;

export interface LeaseRecord {
  id: string;
  swarmId: string;
  taskId: string;
  pattern: string;
  holderAgent: string;
  acquiredAt: string;
  expiresAt: string;
  releasedAt: string | null;
}

interface Row {
  id: string;
  swarm_id: string;
  task_id: string;
  pattern: string;
  holder_agent: string;
  acquired_at: string;
  expires_at: string;
  released_at: string | null;
}

function fromRow(r: Row): LeaseRecord {
  return { id: r.id, swarmId: r.swarm_id, taskId: r.task_id, pattern: r.pattern, holderAgent: r.holder_agent, acquiredAt: r.acquired_at, expiresAt: r.expires_at, releasedAt: r.released_at };
}

export class LeaseRepository {
  constructor(private readonly state: StateService) {}

  create(input: { swarmId: string; taskId: string; pattern: string; holderAgent: string; ttlMs?: number }): Promise<LeaseRecord> {
    return this.state.write((db) => {
      const id = newId();
      const now = Date.now();
      const acquiredAt = new Date(now).toISOString();
      const expiresAt = new Date(now + (input.ttlMs ?? LEASE_TTL_MS)).toISOString();
      db.prepare('INSERT INTO leases (id, swarm_id, task_id, pattern, holder_agent, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id,
        input.swarmId,
        input.taskId,
        input.pattern,
        input.holderAgent,
        acquiredAt,
        expiresAt,
      );
      return { id, swarmId: input.swarmId, taskId: input.taskId, pattern: input.pattern, holderAgent: input.holderAgent, acquiredAt, expiresAt, releasedAt: null };
    });
  }

  release(id: string): Promise<void> {
    return this.state.write((db) => {
      db.prepare('UPDATE leases SET released_at = ? WHERE id = ?').run(nowIso(), id);
    });
  }

  renew(id: string, ttlMs: number = LEASE_TTL_MS): Promise<LeaseRecord> {
    return this.state.write((db) => {
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      db.prepare('UPDATE leases SET expires_at = ? WHERE id = ?').run(expiresAt, id);
      return fromRow(db.prepare('SELECT * FROM leases WHERE id = ?').get(id) as Row);
    });
  }

  listActive(swarmId: string, now: string = nowIso()): LeaseRecord[] {
    const rows = this.state.read((db) =>
      db.prepare('SELECT * FROM leases WHERE swarm_id = ? AND released_at IS NULL AND expires_at > ? ORDER BY acquired_at').all(swarmId, now),
    ) as Row[];
    return rows.map(fromRow);
  }

  releaseAllForTask(taskId: string): Promise<void> {
    return this.state.write((db) => {
      db.prepare('UPDATE leases SET released_at = ? WHERE task_id = ? AND released_at IS NULL').run(nowIso(), taskId);
    });
  }

  releaseAllForSwarm(swarmId: string): Promise<void> {
    return this.state.write((db) => {
      db.prepare('UPDATE leases SET released_at = ? WHERE swarm_id = ? AND released_at IS NULL').run(nowIso(), swarmId);
    });
  }
}
