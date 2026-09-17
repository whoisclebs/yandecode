import { describe, expect, it } from 'vitest';
import { scheduleNext } from '../src/scheduler/scheduler.js';
import type { SchedulerTask } from '../src/scheduler/types.js';

function task(overrides: Partial<SchedulerTask> & { id: string }): SchedulerTask {
  return { status: 'ready', priority: 0, role: 'implementer', paths: [], needsWorktree: false, ...overrides };
}

describe('scheduleNext', () => {
  it('returns only ready tasks, ordered by priority then id, up to remaining capacity', () => {
    const out = scheduleNext({
      maxAgents: 4,
      runningCount: 0,
      activeLeases: [],
      tasks: [
        task({ id: 't-low', priority: 0 }),
        task({ id: 't-high', priority: 5 }),
        task({ id: 't-planned', status: 'planned', priority: 9 }),
      ],
    });
    expect(out.map((r) => r.taskId)).toEqual(['t-high', 't-low']);
  });

  it('respects maxAgents minus already-running workers as remaining capacity', () => {
    const out = scheduleNext({
      maxAgents: 2,
      runningCount: 1,
      activeLeases: [],
      tasks: [task({ id: 't1', priority: 2 }), task({ id: 't2', priority: 1 })],
    });
    expect(out.map((r) => r.taskId)).toEqual(['t1']);
  });

  it('returns nothing when capacity is already exhausted', () => {
    const out = scheduleNext({ maxAgents: 2, runningCount: 2, activeLeases: [], tasks: [task({ id: 't1' })] });
    expect(out).toEqual([]);
  });

  it('excludes a ready task whose paths conflict with an already-active lease', () => {
    const out = scheduleNext({
      maxAgents: 4,
      runningCount: 1,
      activeLeases: [{ pattern: 'src/auth/**' }],
      tasks: [task({ id: 't-conflict', priority: 1, paths: ['src/auth/login.ts'] }), task({ id: 't-ok', priority: 0, paths: ['src/http/**'] })],
    });
    expect(out.map((r) => r.taskId)).toEqual(['t-ok']);
  });

  it('excludes a ready task whose paths conflict with another ready task selected earlier in the same tick', () => {
    const out = scheduleNext({
      maxAgents: 4,
      runningCount: 0,
      activeLeases: [],
      tasks: [task({ id: 't-first', priority: 1, paths: ['src/auth/**'] }), task({ id: 't-second', priority: 0, paths: ['src/auth/login.ts'] })],
    });
    expect(out.map((r) => r.taskId)).toEqual(['t-first']);
  });

  it('sets needsWorktree when a task is explicitly marked, even alone in the tick', () => {
    const out = scheduleNext({ maxAgents: 4, runningCount: 0, activeLeases: [], tasks: [task({ id: 't1', needsWorktree: true, paths: ['src/**'] })] });
    expect(out[0]!.needsWorktree).toBe(true);
  });

  it('sets needsWorktree on every path-writing task when two or more are selected in the same tick', () => {
    const out = scheduleNext({
      maxAgents: 4,
      runningCount: 0,
      activeLeases: [],
      tasks: [
        task({ id: 't-writer-1', priority: 2, paths: ['src/auth/**'] }),
        task({ id: 't-writer-2', priority: 1, paths: ['src/http/**'] }),
        task({ id: 't-scout', priority: 0, role: 'scout', paths: [] }),
      ],
    });
    expect(out.find((r) => r.taskId === 't-writer-1')!.needsWorktree).toBe(true);
    expect(out.find((r) => r.taskId === 't-writer-2')!.needsWorktree).toBe(true);
    expect(out.find((r) => r.taskId === 't-scout')!.needsWorktree).toBe(false);
  });

  it('does not set needsWorktree when only one path-writing task is selected alongside non-writers', () => {
    const out = scheduleNext({
      maxAgents: 4,
      runningCount: 0,
      activeLeases: [],
      tasks: [task({ id: 't-writer', priority: 1, paths: ['src/auth/**'] }), task({ id: 't-scout', priority: 0, role: 'scout', paths: [] })],
    });
    expect(out.find((r) => r.taskId === 't-writer')!.needsWorktree).toBe(false);
  });
});
