import { newId, nowIso } from '../../ids.js';
import { YandeCodeError } from '../../errors.js';
import type { Database } from '../open.js';
import type { StateService } from '../state-service.js';

export type TaskStatus =
  | 'planned'
  | 'ready'
  | 'claimed'
  | 'running'
  | 'blocked'
  | 'review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const VALID_TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  planned: ['ready', 'cancelled'],
  ready: ['claimed', 'cancelled'],
  claimed: ['running', 'cancelled'],
  running: ['review', 'completed', 'blocked', 'failed', 'cancelled'],
  blocked: ['ready', 'cancelled'],
  review: ['completed', 'failed', 'cancelled'],
  failed: ['ready', 'cancelled'],
  completed: [],
  cancelled: [],
};

const TERMINAL_END: ReadonlySet<TaskStatus> = new Set(['completed', 'failed', 'cancelled']);

export interface TaskRecord {
  id: string;
  swarmId: string;
  title: string;
  description: string;
  role: string;
  status: TaskStatus;
  priority: number;
  attempt: number;
  maxAttempts: number;
  ownerAgent: string | null;
  workspaceId: string | null;
  needsWorktree: boolean;
  resultJson: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  dependsOn: string[];
  paths: string[];
}

export interface CreateTaskInput {
  swarmId: string;
  title: string;
  description: string;
  role: string;
  priority?: number;
  maxAttempts?: number;
  needsWorktree?: boolean;
  dependsOn?: string[];
  paths?: string[];
}

interface Row {
  id: string;
  swarm_id: string;
  title: string;
  description: string;
  role: string;
  status: TaskStatus;
  priority: number;
  attempt: number;
  max_attempts: number;
  owner_agent: string | null;
  workspace_id: string | null;
  needs_worktree: number;
  result_json: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export class TaskRepository {
  constructor(private readonly state: StateService) {}

  private hydrate(db: Database, row: Row): TaskRecord {
    const dependsOn = (
      db
        .prepare('SELECT depends_on_task_id AS id FROM task_dependencies WHERE task_id = ?')
        .all(row.id) as { id: string }[]
    ).map((r) => r.id);
    const paths = (
      db.prepare('SELECT pattern FROM task_paths WHERE task_id = ?').all(row.id) as {
        pattern: string;
      }[]
    ).map((r) => r.pattern);
    return {
      id: row.id,
      swarmId: row.swarm_id,
      title: row.title,
      description: row.description,
      role: row.role,
      status: row.status,
      priority: row.priority,
      attempt: row.attempt,
      maxAttempts: row.max_attempts,
      ownerAgent: row.owner_agent,
      workspaceId: row.workspace_id,
      needsWorktree: row.needs_worktree === 1,
      resultJson: row.result_json,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      dependsOn,
      paths,
    };
  }

  createMany(inputs: CreateTaskInput[]): Promise<TaskRecord[]> {
    return this.state.write((db) => {
      const now = nowIso();
      const insertTask = db.prepare(
        'INSERT INTO tasks (id, swarm_id, title, description, role, status, priority, attempt, max_attempts, needs_worktree, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      );
      const insertDep = db.prepare(
        'INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)',
      );
      const insertPath = db.prepare('INSERT INTO task_paths (task_id, pattern) VALUES (?, ?)');
      const ids: string[] = [];
      for (const input of inputs) {
        const id = newId();
        insertTask.run(
          id,
          input.swarmId,
          input.title,
          input.description,
          input.role,
          'planned',
          input.priority ?? 0,
          input.maxAttempts ?? 2,
          input.needsWorktree ? 1 : 0,
          now,
        );
        for (const dep of input.dependsOn ?? []) insertDep.run(id, dep);
        for (const pattern of input.paths ?? []) insertPath.run(id, pattern);
        ids.push(id);
      }
      return ids.map((id) =>
        this.hydrate(db, db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row),
      );
    });
  }

  get(id: string): TaskRecord | null {
    return this.state.read((db) => {
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
      return row ? this.hydrate(db, row) : null;
    });
  }

  listBySwarm(swarmId: string): TaskRecord[] {
    return this.state.read((db) => {
      const rows = db
        .prepare('SELECT * FROM tasks WHERE swarm_id = ? ORDER BY priority DESC, id')
        .all(swarmId) as Row[];
      return rows.map((r) => this.hydrate(db, r));
    });
  }

  listByStatus(swarmId: string, statuses: TaskStatus[]): TaskRecord[] {
    if (statuses.length === 0) return [];
    return this.state.read((db) => {
      const placeholders = statuses.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT * FROM tasks WHERE swarm_id = ? AND status IN (${placeholders}) ORDER BY priority DESC, id`,
        )
        .all(swarmId, ...statuses) as Row[];
      return rows.map((r) => this.hydrate(db, r));
    });
  }

  updateStatus(
    id: string,
    to: TaskStatus,
    opts: {
      ownerAgent?: string | null;
      workspaceId?: string | null;
      resultJson?: string | null;
    } = {},
  ): Promise<TaskRecord> {
    return this.state.write((db) => {
      const applyTransition = (targetTo: TaskStatus, transitionOpts: typeof opts): Row => {
        const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
        if (!row) throw new YandeCodeError('TASK_NOT_FOUND', `no task ${id}`);
        const from = row.status;
        if (!VALID_TASK_TRANSITIONS[from].includes(targetTo)) {
          throw new YandeCodeError(
            'INVALID_TASK_TRANSITION',
            `task ${id}: cannot transition from ${from} to ${targetTo}`,
          );
        }
        if (from === 'failed' && targetTo === 'ready' && row.attempt >= row.max_attempts) {
          throw new YandeCodeError(
            'MAX_ATTEMPTS_EXCEEDED',
            `task ${id}: attempt ${row.attempt} >= maxAttempts ${row.max_attempts}`,
          );
        }
        const now = nowIso();
        const attempt = targetTo === 'running' ? row.attempt + 1 : row.attempt;
        const startedAt = targetTo === 'running' && !row.started_at ? now : row.started_at;
        // Non-terminal targets always clear completedAt rather than preserving a stale value from
        // a prior terminal state (e.g. a failed->ready retry un-terminalizes the task).
        const completedAt = TERMINAL_END.has(targetTo) ? now : null;
        db.prepare(
          'UPDATE tasks SET status = ?, attempt = ?, owner_agent = COALESCE(?, owner_agent), workspace_id = COALESCE(?, workspace_id), result_json = COALESCE(?, result_json), started_at = ?, completed_at = ? WHERE id = ?',
        ).run(
          targetTo,
          attempt,
          transitionOpts.ownerAgent ?? null,
          transitionOpts.workspaceId ?? null,
          transitionOpts.resultJson ?? null,
          startedAt,
          completedAt,
          id,
        );
        return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row;
      };

      let row = applyTransition(to, opts);
      // A task that just failed with attempts remaining is automatically requeued: this is what
      // makes the failed->ready transition in VALID_TASK_TRANSITIONS meaningful in practice, and
      // what makes a retried task reappear in a future swarmNext batch without dispatcher
      // intervention. Runs inside the same write transaction, so it's atomic with the failure.
      if (to === 'failed' && row.attempt < row.max_attempts) {
        row = applyTransition('ready', {});
      }
      return this.hydrate(db, row);
    });
  }

  markReadyWhereDependenciesComplete(swarmId: string): Promise<string[]> {
    return this.state.write((db) => {
      const planned = db
        .prepare("SELECT id FROM tasks WHERE swarm_id = ? AND status = 'planned'")
        .all(swarmId) as { id: string }[];
      const moved: string[] = [];
      for (const { id } of planned) {
        const deps = db
          .prepare('SELECT depends_on_task_id AS depId FROM task_dependencies WHERE task_id = ?')
          .all(id) as { depId: string }[];
        const allComplete = deps.every((d) => {
          const dep = db.prepare('SELECT status FROM tasks WHERE id = ?').get(d.depId) as
            { status: TaskStatus } | undefined;
          return dep?.status === 'completed';
        });
        if (allComplete) {
          db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('ready', id);
          moved.push(id);
        }
      }
      return moved;
    });
  }
}
