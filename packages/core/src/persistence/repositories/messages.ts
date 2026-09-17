import { newId, nowIso } from '../../ids.js';
import { YandeCodeError } from '../../errors.js';
import type { StateService } from '../state-service.js';

export type MessageType = 'finding' | 'question' | 'answer' | 'dependency' | 'warning' | 'result';
export const MESSAGE_PAYLOAD_MAX_BYTES = 16 * 1024;

export interface MessageRecord {
  id: string;
  swarmId: string;
  from: string;
  to: string;
  type: MessageType;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  swarm_id: string;
  from_agent: string;
  to_agent: string;
  type: MessageType;
  payload_json: string;
  read_at: string | null;
  created_at: string;
}

function fromRow(r: Row): MessageRecord {
  return { id: r.id, swarmId: r.swarm_id, from: r.from_agent, to: r.to_agent, type: r.type, payload: JSON.parse(r.payload_json) as unknown, readAt: r.read_at, createdAt: r.created_at };
}

export class MessageRepository {
  constructor(private readonly state: StateService) {}

  send(input: { swarmId: string; from: string; to: string; type: MessageType; payload: unknown }): Promise<MessageRecord> {
    const payloadJson = JSON.stringify(input.payload);
    if (Buffer.byteLength(payloadJson, 'utf8') > MESSAGE_PAYLOAD_MAX_BYTES) {
      return Promise.reject(new YandeCodeError('MESSAGE_PAYLOAD_TOO_LARGE', `message payload exceeds ${MESSAGE_PAYLOAD_MAX_BYTES} bytes`));
    }
    return this.state.write((db) => {
      const id = newId();
      const now = nowIso();
      db.prepare('INSERT INTO messages (id, swarm_id, from_agent, to_agent, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id,
        input.swarmId,
        input.from,
        input.to,
        input.type,
        payloadJson,
        now,
      );
      return { id, swarmId: input.swarmId, from: input.from, to: input.to, type: input.type, payload: input.payload, readAt: null, createdAt: now };
    });
  }

  markRead(id: string): Promise<void> {
    return this.state.write((db) => {
      db.prepare('UPDATE messages SET read_at = ? WHERE id = ?').run(nowIso(), id);
    });
  }

  listUnreadFor(swarmId: string, toAgent: string): MessageRecord[] {
    const rows = this.state.read((db) =>
      db.prepare('SELECT * FROM messages WHERE swarm_id = ? AND to_agent = ? AND read_at IS NULL ORDER BY created_at').all(swarmId, toAgent),
    ) as Row[];
    return rows.map(fromRow);
  }

  listBySwarm(swarmId: string): MessageRecord[] {
    const rows = this.state.read((db) => db.prepare('SELECT * FROM messages WHERE swarm_id = ? ORDER BY created_at').all(swarmId)) as Row[];
    return rows.map(fromRow);
  }
}
