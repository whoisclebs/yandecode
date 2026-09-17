import { leaseConflicts } from './leases.js';
import type { SchedulerInput, SchedulerTask, SpawnRequest } from './types.js';

function comparePriorityThenId(a: SchedulerTask, b: SchedulerTask): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function scheduleNext(input: SchedulerInput): SpawnRequest[] {
  const capacity = Math.max(0, input.maxAgents - input.runningCount);
  if (capacity === 0) return [];

  const ready = input.tasks.filter((t) => t.status === 'ready').sort(comparePriorityThenId);
  const claimedPatterns = input.activeLeases.map((l) => l.pattern);
  const selected: SchedulerTask[] = [];

  for (const candidate of ready) {
    if (selected.length >= capacity) break;
    const conflicts = candidate.paths.some((p) => claimedPatterns.some((existing) => leaseConflicts(p, existing)));
    if (conflicts) continue;
    selected.push(candidate);
    claimedPatterns.push(...candidate.paths);
  }

  const writerCount = selected.filter((t) => t.paths.length > 0).length;
  return selected.map((t) => ({
    taskId: t.id,
    role: t.role,
    needsWorktree: t.needsWorktree || (writerCount > 1 && t.paths.length > 0),
    paths: t.paths,
  }));
}
