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
  return { state, leases, swarms, tasks, swarmId: swarm.id, taskId: task!.id };
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

  it('renew throws YandeCodeError for a non-existent lease id', async () => {
    const { state, leases } = await setup();
    await expect(leases.renew('does-not-exist')).rejects.toThrow('LEASE_NOT_FOUND');
    state.close();
  });

  it('releaseAllForTask releases only that task\'s leases, leaving a sibling task\'s leases active', async () => {
    const { state, leases, tasks, swarmId, taskId } = await setup();
    const [otherTask] = await tasks.createMany([{ swarmId, title: 't2', description: 'd2', role: 'implementer' }]);
    const mine = await leases.create({ swarmId, taskId, pattern: 'a/**', holderAgent: 'x' });
    const theirs = await leases.create({ swarmId, taskId: otherTask!.id, pattern: 'b/**', holderAgent: 'x' });
    await leases.releaseAllForTask(taskId);
    const active = leases.listActive(swarmId).map((l) => l.id);
    expect(active).toEqual([theirs.id]);
    void mine;
    state.close();
  });

  it('releaseAllForSwarm releases only that swarm\'s leases, leaving another swarm\'s leases active', async () => {
    const { state, leases, swarms, tasks, swarmId, taskId } = await setup();
    const otherSwarm = await swarms.create({ title: 't2', goal: 'g2', strategy: 'adaptive', maxAgents: 4, sessionId: null });
    const [otherTask] = await tasks.createMany([{ swarmId: otherSwarm.id, title: 't', description: 'd', role: 'implementer' }]);
    const mine = await leases.create({ swarmId, taskId, pattern: 'a/**', holderAgent: 'x' });
    const theirs = await leases.create({ swarmId: otherSwarm.id, taskId: otherTask!.id, pattern: 'b/**', holderAgent: 'x' });
    await leases.releaseAllForSwarm(swarmId);
    expect(leases.listActive(swarmId)).toHaveLength(0);
    expect(leases.listActive(otherSwarm.id).map((l) => l.id)).toEqual([theirs.id]);
    void mine;
    state.close();
  });

  it('reserveIfNoConflict grants and creates leases atomically when there is no conflict', async () => {
    const { state, leases, swarmId, taskId } = await setup();
    const result = await leases.reserveIfNoConflict({ swarmId, taskId, patterns: ['a/**', 'b/**'], holderAgent: 'x' }, () => []);
    expect(result.granted).toBe(true);
    expect(result.leases).toHaveLength(2);
    expect(leases.listActive(swarmId)).toHaveLength(2);
    state.close();
  });

  it('reserveIfNoConflict denies and creates nothing when the conflict callback reports a conflict', async () => {
    const { state, leases, swarmId, taskId } = await setup();
    const existing = await leases.create({ swarmId, taskId, pattern: 'a/**', holderAgent: 'x' });
    const result = await leases.reserveIfNoConflict({ swarmId, taskId, patterns: ['a/**'], holderAgent: 'y' }, (_pattern, active) => active);
    expect(result.granted).toBe(false);
    expect(result.conflicts.map((l) => l.id)).toEqual([existing.id]);
    expect(leases.listActive(swarmId)).toHaveLength(1);
    state.close();
  });
});
