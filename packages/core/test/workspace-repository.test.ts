import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StateService } from '../src/persistence/state-service.js';
import { SwarmRepository } from '../src/persistence/repositories/swarms.js';
import { WorkspaceRepository } from '../src/persistence/repositories/workspaces.js';

async function setup() {
  const state = StateService.open(join(mkdtempSync(join(tmpdir(), 'yc-workspaces-')), 'state.db'));
  const swarms = new SwarmRepository(state);
  const workspaces = new WorkspaceRepository(state);
  const swarm = await swarms.create({
    title: 't',
    goal: 'g',
    strategy: 'adaptive',
    maxAgents: 4,
    sessionId: null,
  });
  return { state, workspaces, swarmId: swarm.id };
}

describe('WorkspaceRepository', () => {
  it('creates a worktree workspace and reads it back', async () => {
    const { state, workspaces, swarmId } = await setup();
    const ws = await workspaces.create({
      swarmId,
      kind: 'worktree',
      name: 'task-implement-auth',
      path: '/repo/.worktrees/task-implement-auth',
      branch: 'task/implement-auth',
    });
    expect(workspaces.get(ws.id)).toEqual(ws);
    expect(ws.removedAt).toBeNull();
    state.close();
  });

  it('creates a main workspace with a null branch', async () => {
    const { state, workspaces, swarmId } = await setup();
    const ws = await workspaces.create({ swarmId, kind: 'main', name: 'main', path: '/repo' });
    expect(ws.branch).toBeNull();
    state.close();
  });

  it('listBySwarm returns every workspace for that swarm; markRemoved sets removedAt', async () => {
    const { state, workspaces, swarmId } = await setup();
    const a = await workspaces.create({ swarmId, kind: 'main', name: 'main', path: '/repo' });
    const b = await workspaces.create({
      swarmId,
      kind: 'worktree',
      name: 'wt',
      path: '/repo/.worktrees/wt',
    });
    expect(
      workspaces
        .listBySwarm(swarmId)
        .map((w) => w.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    await workspaces.markRemoved(b.id);
    expect(workspaces.get(b.id)!.removedAt).not.toBeNull();
    state.close();
  });

  it('findActiveByPath returns the newest non-removed workspace at that path, or null once all are removed', async () => {
    const { state, workspaces, swarmId } = await setup();
    expect(workspaces.findActiveByPath('/repo/.worktrees/wt')).toBeNull();
    const first = await workspaces.create({
      swarmId,
      kind: 'worktree',
      name: 'wt',
      path: '/repo/.worktrees/wt',
    });
    expect(workspaces.findActiveByPath('/repo/.worktrees/wt')?.id).toBe(first.id);
    await workspaces.markRemoved(first.id);
    expect(workspaces.findActiveByPath('/repo/.worktrees/wt')).toBeNull();
    const second = await workspaces.create({
      swarmId,
      kind: 'worktree',
      name: 'wt',
      path: '/repo/.worktrees/wt',
    });
    expect(workspaces.findActiveByPath('/repo/.worktrees/wt')?.id).toBe(second.id);
    state.close();
  });
});
