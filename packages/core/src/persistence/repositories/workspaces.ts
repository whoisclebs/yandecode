import { newId, nowIso } from '../../ids.js';
import type { StateService } from '../state-service.js';

export type WorkspaceKind = 'main' | 'worktree';

export interface WorkspaceRecord {
  id: string;
  swarmId: string;
  kind: WorkspaceKind;
  name: string;
  path: string;
  branch: string | null;
  createdAt: string;
  removedAt: string | null;
}

interface Row {
  id: string;
  swarm_id: string;
  kind: WorkspaceKind;
  name: string;
  path: string;
  branch: string | null;
  created_at: string;
  removed_at: string | null;
}

function fromRow(r: Row): WorkspaceRecord {
  return { id: r.id, swarmId: r.swarm_id, kind: r.kind, name: r.name, path: r.path, branch: r.branch, createdAt: r.created_at, removedAt: r.removed_at };
}

export class WorkspaceRepository {
  constructor(private readonly state: StateService) {}

  create(input: { swarmId: string; kind: WorkspaceKind; name: string; path: string; branch?: string | null }): Promise<WorkspaceRecord> {
    return this.state.write((db) => {
      const id = newId();
      const now = nowIso();
      const branch = input.branch ?? null;
      db.prepare('INSERT INTO workspaces (id, swarm_id, kind, name, path, branch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id,
        input.swarmId,
        input.kind,
        input.name,
        input.path,
        branch,
        now,
      );
      return { id, swarmId: input.swarmId, kind: input.kind, name: input.name, path: input.path, branch, createdAt: now, removedAt: null };
    });
  }

  get(id: string): WorkspaceRecord | null {
    const row = this.state.read((db) => db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id)) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  listBySwarm(swarmId: string): WorkspaceRecord[] {
    const rows = this.state.read((db) => db.prepare('SELECT * FROM workspaces WHERE swarm_id = ? ORDER BY created_at').all(swarmId)) as Row[];
    return rows.map(fromRow);
  }

  markRemoved(id: string): Promise<void> {
    return this.state.write((db) => {
      db.prepare('UPDATE workspaces SET removed_at = ? WHERE id = ?').run(nowIso(), id);
    });
  }
}
