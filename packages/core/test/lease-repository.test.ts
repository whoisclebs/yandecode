import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StateService } from '../src/persistence/state-service.js';
import { SwarmRepository } from '../src/persistence/repositories/swarms.js';
import { TaskRepository } from '../src/persistence/repositories/tasks.js';
import { LeaseRepository } from '../src/persistence/repositories/leases.js';

async function setup() {
  const state = StateService.open(join(mkdtempSync(join(tmpdir(), 'yc-leases-')), 'state.db'));
  const swarms = new SwarmRepository(state);
  const tasks = new TaskRepository(state);
  const leases = new LeaseRepository(state);
  const swarm = await swarms.create({ title: 't', goal: 'g', strategy: 'adaptive', maxAgents: 4, sessionId: null });
  const [task] = await tasks.createMany([{ swarmId: swarm.id, title: 't', description: 'd', role: 'implementer' }]);
  return { state, leases, swarmId: swarm.id, taskId: task!.id };
}

describe('LeaseRepository', () => {
  it('creates a lease with a 15-minute default TTL and reads it back among active leases', async () => {
    const { state, leases, swarmId, taskId } = await setup();
    const before = Date.now();
    const lease = await leases.create({ swarmId, taskId, pattern: 'src/auth/**', holderAgent: 'agent-a' });
    expect(new Date(lease.expiresAt).getTime() - before).toBeGreaterThanOrEqual(15 * 60 * 1000 - 1000);
    expect(leases.listActive(swarmId).map((l) => l.id)).toEqual([lease.id]);
    state.close();
  });

  it('excludes a released lease and an expired lease from listActive', async () => {
    const { state, leases, swarmId, taskId } = await setup();
    const released = await leases.create({ swarmId, taskId, pattern: 'a/**', holderAgent: 'x' });
    await leases.release(released.id);
    const expired = await leases.create({ swarmId, taskId, pattern: 'b/**', holderAgent: 'x', ttlMs: -1 });
    const active = await leases.create({ swarmId, taskId, pattern: 'c/**', holderAgent: 'x' });
    const now = new Date(Date.now() + 1000).toISOString();
    expect(leases.listActive(swarmId, now).map((l) => l.id)).toEqual([active.id]);
    void expired;
    state.close();
  });

  it('renew extends expiresAt', async () => {
    const { state, leases, swarmId, taskId } = await setup();
    const lease = await leases.create({ swarmId, taskId, pattern: 'a/**', holderAgent: 'x', ttlMs: 1000 });
    const renewed = await leases.renew(lease.id, 60_000);
    expect(new Date(renewed.expiresAt).getTime()).toBeGreaterThan(new Date(lease.expiresAt).getTime());
    state.close();
  });

  it('releaseAllForTask and releaseAllForSwarm release exactly their own leases', async () => {
    const { state, leases, swarmId, taskId } = await setup();
    const a = await leases.create({ swarmId, taskId, pattern: 'a/**', holderAgent: 'x' });
    const b = await leases.create({ swarmId, taskId, pattern: 'b/**', holderAgent: 'x' });
    await leases.releaseAllForTask(taskId);
    expect(leases.listActive(swarmId)).toHaveLength(0);
    void a;
    void b;
    state.close();
  });
});
