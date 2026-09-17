export const SWARM_PACKAGE = '@yandecode/swarm';
export { leaseConflicts, matchesPattern } from './scheduler/leases.js';
export { validateAcyclic, type DagNode } from './scheduler/dag.js';
export { scheduleNext } from './scheduler/scheduler.js';
export type {
  ActiveLease,
  SchedulerInput,
  SchedulerTask,
  SchedulerTaskStatus,
  SpawnRequest,
} from './scheduler/types.js';
export {
  SwarmService,
  type SwarmServiceDeps,
  type TaskCreateInput,
  type WorkspaceReserveResult,
} from './service/swarm-service.js';
