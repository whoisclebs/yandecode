import { newId, nowIso } from '../../ids.js';
import type { StateService } from '../state-service.js';

export type SwarmStrategy = 'adaptive' | 'pipeline' | 'star';
export type SwarmStatus = 'active' | 'completed' | 'failed' | 'cancelled';

export interface SwarmRecord {
  id: string;
  title: string;
  goal: string;
  strategy: SwarmStrategy;
  status: SwarmStatus;
  maxAgents: number;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateSwarmInput {
  title: string;
  goal: string;
  strategy: SwarmStrategy;
  maxAgents: number;
  sessionId: string | null;
}

interface Row {
  id: string;
  title: string;
  goal: string;
  strategy: SwarmStrategy;
  status: SwarmStatus;
  max_agents: number;
  session_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function fromRow(r: Row): SwarmRecord {
  return {
    id: r.id,
    title: r.title,
    goal: r.goal,
    strategy: r.strategy,
    status: r.status,
    maxAgents: r.max_agents,
    sessionId: r.session_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

const TERMINAL: ReadonlySet<SwarmStatus> = new Set(['completed', 'failed', 'cancelled']);

export class SwarmRepository {
  constructor(private readonly state: StateService) {}

  create(input: CreateSwarmInput): Promise<SwarmRecord> {
    return this.state.write((db) => {
      const id = newId();
      const now = nowIso();
      db.prepare(
        'INSERT INTO swarms (id, title, goal, strategy, status, max_agents, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, input.title, input.goal, input.strategy, 'active', input.maxAgents, input.sessionId, now, now);
      return { id, title: input.title, goal: input.goal, strategy: input.strategy, status: 'active', maxAgents: input.maxAgents, sessionId: input.sessionId, createdAt: now, updatedAt: now, completedAt: null };
    });
  }

  get(id: string): SwarmRecord | null {
    const row = this.state.read((db) => db.prepare('SELECT * FROM swarms WHERE id = ?').get(id)) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  setStatus(id: string, status: SwarmStatus): Promise<void> {
    return this.state.write((db) => {
      const now = nowIso();
      db.prepare('UPDATE swarms SET status = ?, updated_at = ?, completed_at = CASE WHEN ? THEN ? ELSE completed_at END WHERE id = ?').run(
        status,
        now,
        TERMINAL.has(status) ? 1 : 0,
        now,
        id,
      );
    });
  }

  listActive(): SwarmRecord[] {
    const rows = this.state.read((db) => db.prepare("SELECT * FROM swarms WHERE status = 'active' ORDER BY created_at").all()) as Row[];
    return rows.map(fromRow);
  }
}
