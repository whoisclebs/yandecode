import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StateService } from '../src/persistence/state-service.js';
import { SwarmRepository } from '../src/persistence/repositories/swarms.js';

function open(): StateService {
  return StateService.open(join(mkdtempSync(join(tmpdir(), 'yc-swarms-')), 'state.db'));
}

describe('SwarmRepository', () => {
  it('creates a swarm with defaults and reads it back', async () => {
    const state = open();
    const repo = new SwarmRepository(state);
    const swarm = await repo.create({
      title: 'Add auth',
      goal: 'Implement login',
      strategy: 'adaptive',
      maxAgents: 4,
      sessionId: null,
    });
    expect(swarm.status).toBe('active');
    expect(repo.get(swarm.id)).toEqual(swarm);
    state.close();
  });

  it('updates status and updatedAt, and sets completedAt on a terminal status', async () => {
    const state = open();
    const repo = new SwarmRepository(state);
    const swarm = await repo.create({
      title: 't',
      goal: 'g',
      strategy: 'star',
      maxAgents: 2,
      sessionId: null,
    });
    await repo.setStatus(swarm.id, 'completed');
    const after = repo.get(swarm.id)!;
    expect(after.status).toBe('completed');
    expect(after.completedAt).not.toBeNull();
    state.close();
  });

  it('listActive returns only active swarms', async () => {
    const state = open();
    const repo = new SwarmRepository(state);
    const a = await repo.create({
      title: 'a',
      goal: 'g',
      strategy: 'adaptive',
      maxAgents: 2,
      sessionId: null,
    });
    const b = await repo.create({
      title: 'b',
      goal: 'g',
      strategy: 'adaptive',
      maxAgents: 2,
      sessionId: null,
    });
    await repo.setStatus(b.id, 'cancelled');
    expect(repo.listActive().map((s) => s.id)).toEqual([a.id]);
    state.close();
  });

  it('getMostRecentActive returns the newest active swarm, or null once none are active', async () => {
    const state = open();
    const repo = new SwarmRepository(state);
    expect(repo.getMostRecentActive()).toBeNull();
    const a = await repo.create({
      title: 'a',
      goal: 'g',
      strategy: 'adaptive',
      maxAgents: 2,
      sessionId: null,
    });
    const b = await repo.create({
      title: 'b',
      goal: 'g',
      strategy: 'adaptive',
      maxAgents: 2,
      sessionId: null,
    });
    expect(repo.getMostRecentActive()?.id).toBe(b.id);
    await repo.setStatus(b.id, 'cancelled');
    expect(repo.getMostRecentActive()?.id).toBe(a.id);
    await repo.setStatus(a.id, 'completed');
    expect(repo.getMostRecentActive()).toBeNull();
    state.close();
  });
});
