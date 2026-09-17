import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StateService } from '../src/persistence/state-service.js';
import { SwarmRepository } from '../src/persistence/repositories/swarms.js';
import { MessageRepository } from '../src/persistence/repositories/messages.js';

async function setup() {
  const state = StateService.open(join(mkdtempSync(join(tmpdir(), 'yc-messages-')), 'state.db'));
  const swarms = new SwarmRepository(state);
  const messages = new MessageRepository(state);
  const swarm = await swarms.create({
    title: 't',
    goal: 'g',
    strategy: 'adaptive',
    maxAgents: 4,
    sessionId: null,
  });
  return { state, messages, swarmId: swarm.id };
}

describe('MessageRepository', () => {
  it('sends a message, round-trips the payload as parsed JSON, and lists it as unread', async () => {
    const { state, messages, swarmId } = await setup();
    const payload = { summary: 'found the bug', evidence: [{ path: 'src/x.ts', lines: [10, 12] }] };
    const msg = await messages.send({
      swarmId,
      from: 'task-scout',
      to: 'task-implementer',
      type: 'finding',
      payload,
    });
    expect(msg.payload).toEqual(payload);
    expect(msg.readAt).toBeNull();
    expect(messages.listUnreadFor(swarmId, 'task-implementer').map((m) => m.id)).toEqual([msg.id]);
    state.close();
  });

  it('markRead removes a message from the unread list', async () => {
    const { state, messages, swarmId } = await setup();
    const msg = await messages.send({
      swarmId,
      from: 'a',
      to: 'b',
      type: 'question',
      payload: { q: 'why?' },
    });
    await messages.markRead(msg.id);
    expect(messages.listUnreadFor(swarmId, 'b')).toEqual([]);
    expect(messages.listBySwarm(swarmId)[0]!.readAt).not.toBeNull();
    state.close();
  });

  it('rejects a payload larger than 16 KB', async () => {
    const { state, messages, swarmId } = await setup();
    const huge = { blob: 'x'.repeat(17 * 1024) };
    await expect(
      messages.send({ swarmId, from: 'a', to: 'b', type: 'warning', payload: huge }),
    ).rejects.toThrow(/MESSAGE_PAYLOAD_TOO_LARGE/);
    state.close();
  });

  it('rejects an invalid message type at the database layer', async () => {
    const { state, messages, swarmId } = await setup();
    // @ts-expect-error deliberately invalid type to prove the DB CHECK constraint is the backstop
    await expect(
      messages.send({ swarmId, from: 'a', to: 'b', type: 'not-a-type', payload: {} }),
    ).rejects.toThrow();
    state.close();
  });
});
