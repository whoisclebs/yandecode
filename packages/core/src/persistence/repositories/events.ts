import { newId, nowIso } from '../../ids.js';
import type { StateService } from '../state-service.js';

export interface EventInput {
  event: string;
  agent?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

export interface EventRecord extends EventInput {
  id: string;
  ts: string;
}

interface Row {
  id: string;
  ts: string;
  event: string;
  agent: string | null;
  duration_ms: number | null;
  data_json: string | null;
}

function fromRow(r: Row): EventRecord {
  const rec: EventRecord = { id: r.id, ts: r.ts, event: r.event };
  if (r.agent !== null) rec.agent = r.agent;
  if (r.duration_ms !== null) rec.durationMs = r.duration_ms;
  if (r.data_json !== null) rec.data = JSON.parse(r.data_json) as Record<string, unknown>;
  return rec;
}

export class EventRepository {
  constructor(private readonly state: StateService) {}

  record(input: EventInput): Promise<EventRecord> {
    const rec: EventRecord = { ...input, id: newId(), ts: nowIso() };
    return this.state.write((db) => {
      db.prepare('INSERT INTO events (id, ts, event, agent, duration_ms, data_json) VALUES (?, ?, ?, ?, ?, ?)').run(
        rec.id,
        rec.ts,
        rec.event,
        rec.agent ?? null,
        rec.durationMs ?? null,
        rec.data === undefined ? null : JSON.stringify(rec.data),
      );
      return rec;
    });
  }

  recent(limit: number): EventRecord[] {
    const rows = this.state.read((db) => db.prepare('SELECT * FROM events ORDER BY rowid DESC LIMIT ?').all(limit)) as Row[];
    return rows.map(fromRow);
  }
}
