import type {
  LeaseRepository,
  SwarmRepository,
  TaskRepository,
  WorkspaceRepository,
} from '@yandecode/core';
import {
  YandeCodeError,
  type CreateTaskInput,
  type LeaseRecord,
  type SwarmRecord,
  type SwarmStrategy,
  type TaskRecord,
  type TaskStatus,
  type WorkspaceRecord,
} from '@yandecode/core';
import { validateAcyclic, type DagNode } from '../scheduler/dag.js';
import { leaseConflicts } from '../scheduler/leases.js';
import { scheduleNext } from '../scheduler/scheduler.js';
import type { ActiveLease, SpawnRequest } from '../scheduler/types.js';

export interface TaskCreateInput {
  ref: string;
  title: string;
  description: string;
  role: string;
  priority?: number;
  maxAttempts?: number;
  needsWorktree?: boolean;
  dependsOn?: string[];
  paths?: string[];
}

export interface SwarmServiceDeps {
  swarms: SwarmRepository;
  tasks: TaskRepository;
  leases: LeaseRepository;
  workspaces: WorkspaceRepository;
}

export interface WorkspaceReserveResult {
  granted: boolean;
  leases: LeaseRecord[];
  conflicts: LeaseRecord[];
}

const RUNNING_LIKE: readonly TaskStatus[] = ['claimed', 'running'];
const LEASE_RELEASING: readonly TaskStatus[] = ['blocked', 'completed', 'failed', 'cancelled'];

export class SwarmService {
  constructor(private readonly deps: SwarmServiceDeps) {}

  createSwarm(input: {
    title: string;
    goal: string;
    strategy: SwarmStrategy;
    maxAgents?: number;
    sessionId: string | null;
  }): Promise<SwarmRecord> {
    return this.deps.swarms.create({
      title: input.title,
      goal: input.goal,
      strategy: input.strategy,
      maxAgents: input.maxAgents ?? 4,
      sessionId: input.sessionId,
    });
  }

  async taskCreate(swarmId: string, inputs: TaskCreateInput[]): Promise<TaskRecord[]> {
    if (inputs.length === 0) return [];
    const refs = new Set(inputs.map((i) => i.ref));
    if (refs.size !== inputs.length)
      throw new YandeCodeError(
        'DUPLICATE_TASK_REF',
        'ref values must be unique within one taskCreate call',
      );

    const existing = this.deps.tasks.listBySwarm(swarmId);
    const existingIds = new Set(existing.map((t) => t.id));
    for (const input of inputs) {
      for (const dep of input.dependsOn ?? []) {
        if (!refs.has(dep) && !existingIds.has(dep)) {
          throw new YandeCodeError(
            'UNRESOLVED_TASK_DEPENDENCY',
            `task ${input.ref} depends on unknown ref/id ${dep}`,
          );
        }
      }
    }

    const dagNodes: DagNode[] = inputs.map((i) => ({
      id: i.ref,
      dependsOn: (i.dependsOn ?? []).filter((d) => refs.has(d)),
    }));
    for (const id of existingIds) dagNodes.push({ id, dependsOn: [] });
    validateAcyclic(dagNodes);

    const byRef = new Map(inputs.map((i) => [i.ref, i]));
    const resolvedIds = new Map<string, string>();
    const created: TaskRecord[] = [];
    const pending = new Set(inputs.map((i) => i.ref));

    while (pending.size > 0) {
      const layerRefs = [...pending].filter((ref) =>
        (byRef.get(ref)!.dependsOn ?? []).every((d) => resolvedIds.has(d) || existingIds.has(d)),
      );
      const layerInputs: CreateTaskInput[] = layerRefs.map((ref) => {
        const spec = byRef.get(ref)!;
        return {
          swarmId,
          title: spec.title,
          description: spec.description,
          role: spec.role,
          ...(spec.priority !== undefined ? { priority: spec.priority } : {}),
          ...(spec.maxAttempts !== undefined ? { maxAttempts: spec.maxAttempts } : {}),
          ...(spec.needsWorktree !== undefined ? { needsWorktree: spec.needsWorktree } : {}),
          dependsOn: (spec.dependsOn ?? []).map((d) => resolvedIds.get(d) ?? d),
          ...(spec.paths !== undefined ? { paths: spec.paths } : {}),
        };
      });
      const records = await this.deps.tasks.createMany(layerInputs);
      for (let i = 0; i < layerRefs.length; i += 1) {
        resolvedIds.set(layerRefs[i]!, records[i]!.id);
        created.push(records[i]!);
        pending.delete(layerRefs[i]!);
      }
    }
    return created;
  }

  async swarmNext(swarmId: string): Promise<SpawnRequest[]> {
    await this.deps.tasks.markReadyWhereDependenciesComplete(swarmId);
    const swarm = this.deps.swarms.get(swarmId);
    if (!swarm) throw new YandeCodeError('SWARM_NOT_FOUND', `no swarm ${swarmId}`);

    const allTasks = this.deps.tasks.listBySwarm(swarmId);
    const realLeases: ActiveLease[] = this.deps.leases
      .listActive(swarmId)
      .map((l) => ({ pattern: l.pattern }));
    const claimedPaths: ActiveLease[] = allTasks
      .filter((t) => RUNNING_LIKE.includes(t.status))
      .flatMap((t) => t.paths.map((p) => ({ pattern: p })));
    const runningCount = allTasks.filter((t) => RUNNING_LIKE.includes(t.status)).length;

    const requests = scheduleNext({
      tasks: allTasks.map((t) => ({
        id: t.id,
        status: t.status,
        priority: t.priority,
        role: t.role,
        paths: t.paths,
        needsWorktree: t.needsWorktree,
      })),
      activeLeases: [...realLeases, ...claimedPaths],
      runningCount,
      maxAgents: swarm.maxAgents,
    });

    for (const request of requests) {
      await this.deps.tasks.updateStatus(request.taskId, 'claimed');
    }
    return requests;
  }

  async taskUpdate(
    taskId: string,
    to: TaskStatus,
    opts: {
      ownerAgent?: string | null;
      workspaceId?: string | null;
      resultJson?: string | null;
    } = {},
  ): Promise<TaskRecord> {
    const updated = await this.deps.tasks.updateStatus(taskId, to, opts);
    if (to === 'running') {
      for (const pattern of updated.paths) {
        await this.deps.leases.create({
          swarmId: updated.swarmId,
          taskId,
          pattern,
          holderAgent: opts.ownerAgent ?? updated.ownerAgent ?? taskId,
        });
      }
    } else if (LEASE_RELEASING.includes(to)) {
      await this.deps.leases.releaseAllForTask(taskId);
    }
    return updated;
  }

  async swarmCancel(
    swarmId: string,
  ): Promise<{ cancelledTaskIds: string[]; pendingWorktrees: WorkspaceRecord[] }> {
    const tasks = this.deps.tasks.listBySwarm(swarmId);
    const cancelledTaskIds: string[] = [];
    for (const task of tasks) {
      if (task.status === 'completed' || task.status === 'cancelled') continue;
      await this.taskUpdate(task.id, 'cancelled');
      cancelledTaskIds.push(task.id);
    }
    await this.deps.leases.releaseAllForSwarm(swarmId);
    await this.deps.swarms.setStatus(swarmId, 'cancelled');
    const pendingWorktrees = this.deps.workspaces
      .listBySwarm(swarmId)
      .filter((w) => w.kind === 'worktree' && w.removedAt === null);
    return { cancelledTaskIds, pendingWorktrees };
  }

  taskList(swarmId: string, statuses?: TaskStatus[]): TaskRecord[] {
    return statuses && statuses.length > 0 ? this.deps.tasks.listByStatus(swarmId, statuses) : this.deps.tasks.listBySwarm(swarmId);
  }

  getSwarm(swarmId: string): SwarmRecord | null {
    return this.deps.swarms.get(swarmId);
  }

  getTask(taskId: string): TaskRecord | null {
    return this.deps.tasks.get(taskId);
  }

  async workspaceReserve(input: {
    swarmId: string;
    taskId: string;
    patterns: string[];
    holderAgent: string;
  }): Promise<WorkspaceReserveResult> {
    const task = this.deps.tasks.get(input.taskId);
    if (!task || task.swarmId !== input.swarmId) {
      throw new YandeCodeError('TASK_SWARM_MISMATCH', `task ${input.taskId} does not belong to swarm ${input.swarmId}`);
    }
    return this.deps.leases.reserveIfNoConflict(input, (pattern, active) =>
      active.filter((lease) => leaseConflicts(pattern, lease.pattern)),
    );
  }

  workspaceRelease(taskId: string): Promise<void> {
    return this.deps.leases.releaseAllForTask(taskId);
  }
}
