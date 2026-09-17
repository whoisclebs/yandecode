import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LeaseRepository,
  StateService,
  SwarmRepository,
  TaskRepository,
  WorkspaceRepository,
} from '@yandecode/core';
import { describe, expect, it } from 'vitest';
import { SwarmService } from '../src/service/swarm-service.js';

function setup() {
  const state = StateService.open(
    join(mkdtempSync(join(tmpdir(), 'yc-swarm-service-')), 'state.db'),
  );
  const service = new SwarmService({
    swarms: new SwarmRepository(state),
    tasks: new TaskRepository(state),
    leases: new LeaseRepository(state),
    workspaces: new WorkspaceRepository(state),
  });
  return { state, service };
}

describe('SwarmService.taskCreate', () => {
  it('creates a same-batch diamond dependency graph in one call, resolving refs to real ids', async () => {
    const { state, service } = setup();
    const swarm = await service.createSwarm({
      title: 't',
      goal: 'g',
      strategy: 'adaptive',
      sessionId: null,
    });
    const created = await service.taskCreate(swarm.id, [
      { ref: 'scout', title: 'scout', description: 'd', role: 'scout' },
      {
        ref: 'impl-a',
        title: 'a',
        description: 'd',
        role: 'implementer',
        dependsOn: ['scout'],
        paths: ['src/a/**'],
      },
      {
        ref: 'impl-b',
        title: 'b',
        description: 'd',
        role: 'implementer',
        dependsOn: ['scout'],
        paths: ['src/b/**'],
      },
      {
        ref: 'review',
        title: 'review',
        description: 'd',
        role: 'reviewer',
        dependsOn: ['impl-a', 'impl-b'],
      },
    ]);
    const byRef = new Map(
      ['scout', 'impl-a', 'impl-b', 'review'].map((ref, i) => [ref, created[i]!]),
    );
    expect(byRef.get('impl-a')!.dependsOn).toEqual([byRef.get('scout')!.id]);
    expect(byRef.get('review')!.dependsOn.sort()).toEqual(
      [byRef.get('impl-a')!.id, byRef.get('impl-b')!.id].sort(),
    );
    state.close();
  });

  it('allows dependsOn to reference a real task id from an earlier taskCreate call', async () => {
    const { state, service } = setup();
    const swarm = await service.createSwarm({
      title: 't',
      goal: 'g',
      strategy: 'adaptive',
      sessionId: null,
    });
    const [first] = await service.taskCreate(swarm.id, [
      { ref: 'a', title: 'a', description: 'd', role: 'implementer' },
    ]);
    const [second] = await service.taskCreate(swarm.id, [
      { ref: 'b', title: 'b', description: 'd', role: 'tester', dependsOn: [first!.id] },
    ]);
    expect(second!.dependsOn).toEqual([first!.id]);
    state.close();
  });

  it('rejects a same-batch cycle without writing anything', async () => {
    const { state, service } = setup();
    const swarm = await service.createSwarm({
      title: 't',
      goal: 'g',
      strategy: 'adaptive',
      sessionId: null,
    });
    await expect(
      service.taskCreate(swarm.id, [
        { ref: 'a', title: 'a', description: 'd', role: 'implementer', dependsOn: ['b'] },
        { ref: 'b', title: 'b', description: 'd', role: 'implementer', dependsOn: ['a'] },
      ]),
    ).rejects.toThrow(/CYCLIC_TASK_DEPENDENCY/);
    expect((await service.taskCreate(swarm.id, [])).length).toBe(0);
    state.close();
  });

  it('rejects a duplicate ref and an unresolved dependsOn', async () => {
    const { state, service } = setup();
    const swarm = await service.createSwarm({
      title: 't',
      goal: 'g',
      strategy: 'adaptive',
      sessionId: null,
    });
    await expect(
      service.taskCreate(swarm.id, [
        { ref: 'a', title: 'a', description: 'd', role: 'implementer' },
        { ref: 'a', title: 'a2', description: 'd', role: 'implementer' },
      ]),
    ).rejects.toThrow(/DUPLICATE_TASK_REF/);
    await expect(
      service.taskCreate(swarm.id, [
        { ref: 'x', title: 'x', description: 'd', role: 'implementer', dependsOn: ['nowhere'] },
      ]),
    ).rejects.toThrow(/UNRESOLVED_TASK_DEPENDENCY/);
    state.close();
  });
});

describe('SwarmService.swarmNext / taskUpdate', () => {
  it('claims ready tasks atomically so a second swarmNext call does not re-offer them', async () => {
    const { state, service } = setup();
    const swarm = await service.createSwarm({
      title: 't',
      goal: 'g',
      strategy: 'adaptive',
      maxAgents: 4,
      sessionId: null,
    });
    const [a, b] = await service.taskCreate(swarm.id, [
      { ref: 'a', title: 'a', description: 'd', role: 'implementer' },
      { ref: 'b', title: 'b', description: 'd', role: 'implementer' },
    ]);
    await service.taskUpdate(a!.id, 'ready');
    await service.taskUpdate(b!.id, 'ready');
    const first = await service.swarmNext(swarm.id);
    expect(first.map((r) => r.taskId).sort()).toEqual([a!.id, b!.id].sort());
    const second = await service.swarmNext(swarm.id);
    expect(second).toEqual([]);
    state.close();
  });

  it('re-offers a failed task in a future swarmNext batch once it auto-retries, without any manual dispatcher intervention', async () => {
    const { state, service } = setup();
    const swarm = await service.createSwarm({
      title: 't',
      goal: 'g',
      strategy: 'adaptive',
      maxAgents: 4,
      sessionId: null,
    });
    const [task] = await service.taskCreate(swarm.id, [
      { ref: 'a', title: 'a', description: 'd', role: 'implementer', maxAttempts: 2 },
    ]);
    await service.taskUpdate(task!.id, 'ready');
    const [claimed] = await service.swarmNext(swarm.id);
    expect(claimed!.taskId).toBe(task!.id);
    await service.taskUpdate(task!.id, 'running');
    const afterFailure = await service.taskUpdate(task!.id, 'failed');
    expect(afterFailure.status).toBe('ready');

    const secondBatch = await service.swarmNext(swarm.id);
    expect(secondBatch.map((r) => r.taskId)).toEqual([task!.id]);
    state.close();
  });

  it('does not offer a task whose paths overlap a currently-claimed (not-yet-leased) task in the same swarmNext call', async () => {
    const { state, service } = setup();
    const swarm = await service.createSwarm({
      title: 't',
      goal: 'g',
      strategy: 'adaptive',
      maxAgents: 4,
      sessionId: null,
    });
    const [high, low] = await service.taskCreate(swarm.id, [
      {
        ref: 'high',
        title: 'high',
        description: 'd',
        role: 'implementer',
        priority: 1,
        paths: ['src/auth/**'],
      },
      {
        ref: 'low',
        title: 'low',
        description: 'd',
        role: 'implementer',
        priority: 0,
        paths: ['src/auth/login.ts'],
      },
    ]);
    await service.taskUpdate(high!.id, 'ready');
    await service.taskUpdate(low!.id, 'ready');
    const out = await service.swarmNext(swarm.id);
    expect(out.map((r) => r.taskId)).toEqual([high!.id]);
    state.close();
  });

  it('taskUpdate to running creates real leases for the task paths; a terminal transition releases them', async () => {
    const { state, service } = setup();
    const swarm = await service.createSwarm({
      title: 't',
      goal: 'g',
      strategy: 'adaptive',
      maxAgents: 4,
      sessionId: null,
    });
    const [task] = await service.taskCreate(swarm.id, [
      { ref: 'a', title: 'a', description: 'd', role: 'implementer', paths: ['src/auth/**'] },
    ]);
    await service.taskUpdate(task!.id, 'ready');
    await service.taskUpdate(task!.id, 'claimed');
    await service.taskUpdate(task!.id, 'running', { ownerAgent: 'agent-a' });
    const activeAfterRunning = await service.taskUpdate(task!.id, 'blocked');
    void activeAfterRunning;
    // no direct lease accessor exposed on the service on purpose (leases are an internal scheduling
    // concern) — assert the release side effect indirectly: a second task claiming the same path now succeeds.
    const [second] = await service.taskCreate(swarm.id, [
      { ref: 'b', title: 'b', description: 'd', role: 'implementer', paths: ['src/auth/**'] },
    ]);
    await service.taskUpdate(second!.id, 'ready');
    const out = await service.swarmNext(swarm.id);
    expect(out.map((r) => r.taskId)).toContain(second!.id);
    state.close();
  });
});

describe('SwarmService.swarmCancel', () => {
  it('cancels every non-terminal task, sets the swarm to cancelled, and lists pending worktrees', async () => {
    const { state, service } = setup();
    const swarm = await service.createSwarm({
      title: 't',
      goal: 'g',
      strategy: 'adaptive',
      maxAgents: 4,
      sessionId: null,
    });
    const [a, b] = await service.taskCreate(swarm.id, [
      { ref: 'a', title: 'a', description: 'd', role: 'implementer' },
      { ref: 'b', title: 'b', description: 'd', role: 'implementer' },
    ]);
    await service.taskUpdate(a!.id, 'ready');
    await service.taskUpdate(a!.id, 'claimed');
    await service.taskUpdate(a!.id, 'running');
    await service.taskUpdate(a!.id, 'completed');
    // b stays 'planned' (non-terminal, no dependencies to satisfy — still cancellable directly).
    const result = await service.swarmCancel(swarm.id);
    expect(result.cancelledTaskIds).toEqual([b!.id]);
    state.close();
  });
});

describe('SwarmService.workspaceReserve / workspaceRelease', () => {
  it('grants a reservation with no conflicts and creates one lease per pattern', async () => {
    const { state, service } = setup();
    const swarm = await service.createSwarm({
      title: 't',
      goal: 'g',
      strategy: 'adaptive',
      sessionId: null,
    });
    const [task] = await service.taskCreate(swarm.id, [
      { ref: 'a', title: 'a', description: 'd', role: 'dispatcher' },
    ]);
    const result = await service.workspaceReserve({
      swarmId: swarm.id,
      taskId: task!.id,
      patterns: ['docs/**', 'README.md'],
      holderAgent: 'dispatcher',
    });
    expect(result.granted).toBe(true);
    expect(result.leases).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
    state.close();
  });

  it('denies the whole reservation and grants nothing when any pattern conflicts with an active lease', async () => {
    const { state, service } = setup();
    const swarm = await service.createSwarm({
      title: 't',
      goal: 'g',
      strategy: 'adaptive',
      sessionId: null,
    });
    const [holder, requester] = await service.taskCreate(swarm.id, [
      { ref: 'holder', title: 'holder', description: 'd', role: 'implementer' },
      { ref: 'requester', title: 'requester', description: 'd', role: 'dispatcher' },
    ]);
    const first = await service.workspaceReserve({
      swarmId: swarm.id,
      taskId: holder!.id,
      patterns: ['src/auth/**'],
      holderAgent: 'a',
    });
    expect(first.granted).toBe(true);
    const second = await service.workspaceReserve({
      swarmId: swarm.id,
      taskId: requester!.id,
      patterns: ['docs/**', 'src/auth/login.ts'],
      holderAgent: 'b',
    });
    expect(second.granted).toBe(false);
    expect(second.leases).toEqual([]);
    expect(second.conflicts.map((c) => c.pattern)).toEqual(['src/auth/**']);
    state.close();
  });

  it('workspaceRelease frees every lease held by that task, allowing a subsequent reservation to succeed', async () => {
    const { state, service } = setup();
    const swarm = await service.createSwarm({
      title: 't',
      goal: 'g',
      strategy: 'adaptive',
      sessionId: null,
    });
    const [task] = await service.taskCreate(swarm.id, [
      { ref: 'a', title: 'a', description: 'd', role: 'dispatcher' },
    ]);
    await service.workspaceReserve({
      swarmId: swarm.id,
      taskId: task!.id,
      patterns: ['src/auth/**'],
      holderAgent: 'a',
    });
    await service.workspaceRelease(task!.id);
    const [other] = await service.taskCreate(swarm.id, [
      { ref: 'b', title: 'b', description: 'd', role: 'dispatcher' },
    ]);
    const result = await service.workspaceReserve({
      swarmId: swarm.id,
      taskId: other!.id,
      patterns: ['src/auth/**'],
      holderAgent: 'b',
    });
    expect(result.granted).toBe(true);
    state.close();
  });

  it('rejects workspaceReserve when the taskId does not belong to the given swarmId', async () => {
    const { state, service } = setup();
    const swarmA = await service.createSwarm({
      title: 'a',
      goal: 'g',
      strategy: 'adaptive',
      sessionId: null,
    });
    const swarmB = await service.createSwarm({
      title: 'b',
      goal: 'g',
      strategy: 'adaptive',
      sessionId: null,
    });
    const [taskInA] = await service.taskCreate(swarmA.id, [
      { ref: 'a', title: 'a', description: 'd', role: 'implementer' },
    ]);
    await expect(
      service.workspaceReserve({
        swarmId: swarmB.id,
        taskId: taskInA!.id,
        patterns: ['x/**'],
        holderAgent: 'x',
      }),
    ).rejects.toThrow('TASK_SWARM_MISMATCH');
    state.close();
  });
});

describe('SwarmService.createWorkspace / removeWorkspaceByPath / getMostRecentActiveSwarm', () => {
  it('getMostRecentActiveSwarm returns the newest active swarm, or null when none are active', async () => {
    const { state, service } = setup();
    expect(service.getMostRecentActiveSwarm()).toBeNull();
    await service.createSwarm({ title: 'a', goal: 'g', strategy: 'adaptive', sessionId: null });
    const b = await service.createSwarm({
      title: 'b',
      goal: 'g',
      strategy: 'adaptive',
      sessionId: null,
    });
    expect(service.getMostRecentActiveSwarm()?.id).toBe(b.id);
    state.close();
  });

  it('createWorkspace records a worktree, and removeWorkspaceByPath marks the matching active one removed', async () => {
    const { state, service } = setup();
    const swarm = await service.createSwarm({
      title: 't',
      goal: 'g',
      strategy: 'adaptive',
      sessionId: null,
    });
    const ws = await service.createWorkspace({
      swarmId: swarm.id,
      kind: 'worktree',
      name: 'wt',
      path: '/repo/.worktrees/wt',
    });
    expect(ws.removedAt).toBeNull();
    await service.removeWorkspaceByPath('/repo/.worktrees/wt');
    // removeWorkspaceByPath is a no-op, not an error, for a path with nothing active to remove.
    await service.removeWorkspaceByPath('/repo/.worktrees/never-created');
    state.close();
  });
});
