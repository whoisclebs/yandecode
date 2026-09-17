import { describe, expect, it } from 'vitest';
import { formatSwarmDetail, formatSwarmList } from '../src/commands/swarm.js';
import type { SwarmRecord, TaskRecord } from '@yandecode/core';

const swarm: SwarmRecord = { id: 's1', title: 'Add auth', goal: 'Implement login', strategy: 'adaptive', status: 'active', maxAgents: 4, sessionId: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', completedAt: null };

function task(overrides: Partial<TaskRecord> & { id: string; status: TaskRecord['status'] }): TaskRecord {
  return {
    swarmId: 's1',
    title: 't',
    description: 'd',
    role: 'implementer',
    priority: 0,
    attempt: 0,
    maxAttempts: 2,
    ownerAgent: null,
    workspaceId: null,
    needsWorktree: false,
    resultJson: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    dependsOn: [],
    paths: [],
    ...overrides,
  };
}

describe('formatSwarmList', () => {
  it('prints "no active swarms" when the list is empty', () => {
    expect(formatSwarmList([])).toBe('No active swarms.\n');
  });

  it('lists each active swarm with id, title, and strategy', () => {
    const out = formatSwarmList([swarm]);
    expect(out).toContain('s1');
    expect(out).toContain('Add auth');
    expect(out).toContain('adaptive');
  });
});

describe('formatSwarmDetail', () => {
  it('shows the swarm summary and a per-status task count table', () => {
    const out = formatSwarmDetail(swarm, [task({ id: 't1', status: 'running' }), task({ id: 't2', status: 'running' }), task({ id: 't3', status: 'completed' })]);
    expect(out).toContain('Add auth');
    expect(out).toContain('running: 2');
    expect(out).toContain('completed: 1');
  });

  it('omits a status line for a status with zero tasks', () => {
    const out = formatSwarmDetail(swarm, [task({ id: 't1', status: 'running' })]);
    expect(out).not.toContain('blocked:');
  });
});
