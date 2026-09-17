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
export { evaluateWritePolicy, MAX_MEMORY_CONTENT_CHARS, type WritePolicyCandidate, type WritePolicyResult } from './memory/write-policy.js';
export {
  MemoryService,
  NEAR_DUPLICATE_THRESHOLD,
  type MemoryFeedbackInput,
  type MemoryServiceDeps,
  type MemoryStoreInput,
  type MemoryStoreResult,
} from './memory/memory-service.js';
export {
  applyRecencyConfidenceBoost,
  CONFIDENCE_BOOST_WEIGHT,
  DEFAULT_MEMORY_RETRIEVER_CONSTANTS,
  MemoryRetriever,
  RECENCY_BOOST_WEIGHT,
  RECENCY_DECAY_DAYS,
  type MemoryHit,
  type MemoryRetrieverConstants,
  type MemoryRetrieverDeps,
  type MemorySearchOptions,
  type RecencyConfidenceCandidate,
} from './memory/memory-retriever.js';
