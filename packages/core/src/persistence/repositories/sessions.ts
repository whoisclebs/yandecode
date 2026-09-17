import { newId, nowIso } from '../../ids.js';
import type { StateService } from '../state-service.js';

export interface SessionRecord {
  id: string;
  claudeSessionId: string | null;
  cwd: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  compactSummary: string | null;
}

interface Row {
  id: string;
  claude_session_id: string | null;
  cwd: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  compact_summary: string | null;
}

const fromRow = (r: Row): SessionRecord => ({
  id: r.id,
  claudeSessionId: r.claude_session_id,
  cwd: r.cwd,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  endReason: r.end_reason,
  compactSummary: r.compact_summary,
});

export class SessionRepository {
  constructor(private readonly state: StateService) {}

  start(input: { claudeSessionId: string | null; cwd: string }): Promise<SessionRecord> {
    const record: SessionRecord = {
      id: newId(),
      claudeSessionId: input.claudeSessionId,
      cwd: input.cwd,
      startedAt: nowIso(),
      endedAt: null,
      endReason: null,
      compactSummary: null,
    };
    return this.state.write((db) => {
      db.prepare(
        'INSERT INTO sessions (id, claude_session_id, cwd, started_at) VALUES (?, ?, ?, ?)',
      ).run(record.id, record.claudeSessionId, record.cwd, record.startedAt);
      return record;
    });
  }

  findOpenByClaudeId(claudeSessionId: string): SessionRecord | null {
    const row = this.state.read((db) =>
      db
        .prepare(
          'SELECT * FROM sessions WHERE claude_session_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
        )
        .get(claudeSessionId),
    ) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  end(claudeSessionId: string, reason: string): Promise<number> {
    return this.state.write(
      (db) =>
        db
          .prepare(
            'UPDATE sessions SET ended_at = ?, end_reason = ? WHERE claude_session_id = ? AND ended_at IS NULL',
          )
          .run(nowIso(), reason, claudeSessionId).changes,
    );
  }

  setCompactSummary(claudeSessionId: string, summary: string): Promise<void> {
    return this.state.write((db) => {
      db.prepare(
        'UPDATE sessions SET compact_summary = ? WHERE claude_session_id = ? AND ended_at IS NULL',
      ).run(summary, claudeSessionId);
    });
  }
}
