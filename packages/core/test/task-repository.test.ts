import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StateService } from '../src/persistence/state-service.js';
import { SwarmRepository } from '../src/persistence/repositories/swarms.js';
import { TaskRepository } from '../src/persistence/repositories/tasks.js';

async function setup() {
  const state = StateService.open(join(mkdtempSync(join(tmpdir(), 'yc-tasks-')), 'state.db'));
  const swarms = new SwarmRepository(state);
  const tasks = new TaskRepository(state);
  const swarm = await swarms.create({
    title: 't',
    goal: 'g',
    strategy: 'adaptive',
    maxAgents: 4,
    sessionId: null,
  });
  return { state, tasks, swarmId: swarm.id };
}

describe('TaskRepository', () => {
  it('creates a batch of tasks with dependencies and paths, and reads them back', async () => {
    const { state, tasks, swarmId } = await setup();
    const [scout, implementer] = await tasks.createMany([
      { swarmId, title: 'scout', description: 'explore', role: 'scout' },
      {
        swarmId,
        title: 'implement',
        description: 'write code',
        role: 'implementer',
        paths: ['src/auth/**'],
      },
    ]);
    await tasks.createMany([]); // no-op batch is valid
    const withDep = await tasks.createMany([
      {
        swarmId,
        title: 'test',
        description: 'write tests',
        role: 'tester',
        dependsOn: [implementer!.id],
        paths: ['test/**'],
      },
    ]);
    expect(scout!.status).toBe('planned');
    expect(implementer!.paths).toEqual(['src/auth/**']);
    expect(withDep[0]!.dependsOn).toEqual([implementer!.id]);
    expect(tasks.listBySwarm(swarmId)).toHaveLength(3);
    state.close();
  });

  it('walks the full happy-path state machine: planned -> ready -> claimed -> running -> completed', async () => {
    const { state, tasks, swarmId } = await setup();
    const [task] = await tasks.createMany([
      { swarmId, title: 't', description: 'd', role: 'implementer' },
    ]);
    await tasks.updateStatus(task!.id, 'ready');
    await tasks.updateStatus(task!.id, 'claimed', { ownerAgent: 'agent-a' });
    const running = await tasks.updateStatus(task!.id, 'running');
    expect(running.startedAt).not.toBeNull();
    expect(running.attempt).toBe(1);
    const completed = await tasks.updateStatus(task!.id, 'completed', {
      resultJson: '{"STATUS":"ok"}',
    });
    expect(completed.completedAt).not.toBeNull();
    expect(completed.resultJson).toBe('{"STATUS":"ok"}');
    state.close();
  });

  it('rejects a structurally invalid transition', async () => {
    const { state, tasks, swarmId } = await setup();
    const [task] = await tasks.createMany([
      { swarmId, title: 't', description: 'd', role: 'implementer' },
    ]);
    await expect(tasks.updateStatus(task!.id, 'completed')).rejects.toThrow(
      /INVALID_TASK_TRANSITION/,
    );
    state.close();
  });

  it('automatically retries a failed task back to ready while attempt < maxAttempts, clearing completedAt', async () => {
    const { state, tasks, swarmId } = await setup();
    const [task] = await tasks.createMany([
      { swarmId, title: 't', description: 'd', role: 'implementer', maxAttempts: 2 },
    ]);
    await tasks.updateStatus(task!.id, 'ready');
    await tasks.updateStatus(task!.id, 'claimed');
    await tasks.updateStatus(task!.id, 'running'); // attempt 1
    const afterFirstFailure = await tasks.updateStatus(task!.id, 'failed');
    // attempt(1) < maxAttempts(2): the failed->ready retry happens automatically in the same call.
    expect(afterFirstFailure.status).toBe('ready');
    expect(afterFirstFailure.attempt).toBe(1);
    expect(afterFirstFailure.completedAt).toBeNull();
    state.close();
  });

  it('leaves a task failed (does not auto-retry) once attempts are exhausted', async () => {
    const { state, tasks, swarmId } = await setup();
    const [task] = await tasks.createMany([
      { swarmId, title: 't', description: 'd', role: 'implementer', maxAttempts: 2 },
    ]);
    await tasks.updateStatus(task!.id, 'ready');
    await tasks.updateStatus(task!.id, 'claimed');
    await tasks.updateStatus(task!.id, 'running'); // attempt 1
    await tasks.updateStatus(task!.id, 'failed'); // auto-retried to ready
    await tasks.updateStatus(task!.id, 'claimed');
    await tasks.updateStatus(task!.id, 'running'); // attempt 2
    const afterSecondFailure = await tasks.updateStatus(task!.id, 'failed');
    // attempt(2) >= maxAttempts(2): no more retries, stays failed.
    expect(afterSecondFailure.status).toBe('failed');
    expect(afterSecondFailure.completedAt).not.toBeNull();
    await expect(tasks.updateStatus(task!.id, 'ready')).rejects.toThrow(/MAX_ATTEMPTS_EXCEEDED/);
    state.close();
  });

  it('any non-terminal status can move to cancelled; completed/cancelled cannot', async () => {
    const { state, tasks, swarmId } = await setup();
    const [a, b] = await tasks.createMany([
      { swarmId, title: 'a', description: 'd', role: 'implementer' },
      { swarmId, title: 'b', description: 'd', role: 'implementer' },
    ]);
    await tasks.updateStatus(a!.id, 'cancelled');
    expect(tasks.get(a!.id)!.status).toBe('cancelled');
    await expect(tasks.updateStatus(a!.id, 'cancelled')).rejects.toThrow(/INVALID_TASK_TRANSITION/);
    await tasks.updateStatus(b!.id, 'ready');
    await tasks.updateStatus(b!.id, 'claimed');
    await tasks.updateStatus(b!.id, 'running');
    await tasks.updateStatus(b!.id, 'completed');
    await expect(tasks.updateStatus(b!.id, 'cancelled')).rejects.toThrow(/INVALID_TASK_TRANSITION/);
    state.close();
  });

  it('markReadyWhereDependenciesComplete promotes only tasks whose dependencies are all completed', async () => {
    const { state, tasks, swarmId } = await setup();
    // upstream and independent have no recorded dependencies, so both are trivially ready-able.
    const [upstream, independent] = await tasks.createMany([
      { swarmId, title: 'upstream', description: 'd', role: 'implementer' },
      { swarmId, title: 'independent', description: 'd', role: 'scout' },
    ]);
    // withDep references upstream's real id, so it must be created in a second batch.
    const [withDep] = await tasks.createMany([
      { swarmId, title: 'depends', description: 'd', role: 'tester', dependsOn: [upstream!.id] },
    ]);

    let moved = await tasks.markReadyWhereDependenciesComplete(swarmId);
    expect(moved.sort()).toEqual([upstream!.id, independent!.id].sort());
    expect(tasks.get(withDep!.id)!.status).toBe('planned');

    await tasks.updateStatus(upstream!.id, 'claimed');
    await tasks.updateStatus(upstream!.id, 'running');
    await tasks.updateStatus(upstream!.id, 'completed');
    moved = await tasks.markReadyWhereDependenciesComplete(swarmId);
    expect(moved).toEqual([withDep!.id]);
    state.close();
  });
});
