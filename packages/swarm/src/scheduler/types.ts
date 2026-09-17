export type SchedulerTaskStatus = 'planned' | 'ready' | 'claimed' | 'running' | 'blocked' | 'review' | 'completed' | 'failed' | 'cancelled';

export interface SchedulerTask {
  id: string;
  status: SchedulerTaskStatus;
  priority: number;
  role: string;
  paths: string[];
  needsWorktree: boolean;
}

export interface ActiveLease {
  pattern: string;
}

export interface SchedulerInput {
  tasks: SchedulerTask[];
  activeLeases: ActiveLease[];
  runningCount: number;
  maxAgents: number;
}

export interface SpawnRequest {
  taskId: string;
  role: string;
  needsWorktree: boolean;
  paths: string[];
}
