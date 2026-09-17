---
name: yandecode-swarm-protocol
description: How the YandeCode dispatcher creates and drives a swarm through its MCP tools — swarm_create/status/next/cancel, task_create/list/update, message_send/read, workspace_reserve/release, memory_store/search. Use whenever a goal needs more than trivial direct execution.
---

# YandeCode Swarm Protocol

You (the dispatcher) own swarm state through these MCP tools. Claude Code's own `Agent` tool is still what actually runs a worker — the swarm layer only decides what's safe to run together and tracks status; it never executes anything itself.

## The tools

| Tool | When | Key fields |
|---|---|---|
| `swarm_create` | Once, at the start of a non-trivial goal | `title`, `goal`, `strategy` (`'adaptive'` default, `'pipeline'` for a strict chain, `'star'` when tasks don't depend on each other and all report to you) |
| `task_create` | Once, right after `swarm_create`, for the WHOLE DAG in one call | `swarmId`, `tasks[]` — each with `ref` (your own label, used for `dependsOn`), `title`, `description`, `role`, `dependsOn` (array of `ref`s), `paths` (glob patterns it will write; omit or `[]` for read-only roles) |
| `swarm_next` | Repeatedly, in a loop, until no non-terminal tasks remain | `swarmId` → returns the next batch of ready, lease-checked tasks to spawn right now |
| `task_list` | Any time you need the current state of every task | `swarmId`, optional `statuses` filter |
| `swarm_status` | To check whether the swarm is done, or to report progress | `swarmId` → the swarm record plus a per-status task count |
| `swarm_cancel` | Only if the whole goal is abandoned | `swarmId` — cancels every non-terminal task and releases their leases |
| `message_read` | After each `swarm_next` batch returns, or when you suspect a worker is blocked | `swarmId`, `toAgent: 'dispatcher'` — drains unread messages addressed to you |
| `message_send` | To answer a worker's `question`, or to broadcast a `dependency`/`warning` | `swarmId`, `from: 'dispatcher'`, `to` (the blocked task's id), `type`, `payload` |
| `workspace_reserve` / `workspace_release` | You do not call these directly — workers do, per `yandecode-worker-contract` | — |
| `memory_search` | Before planning, and before dispatching any task whose area might have a known failure mode | `query`, optional `namespace` |
| `memory_store` | After the goal completes, only for genuinely reusable findings | `namespace`, `content`, `evidence` (mandatory), `confidence` |

## The DAG

Build the task list as a real dependency graph before calling `task_create`: every task needs a `ref` unique within the call, a `role` matching one of the seven `yandecode-*` agents, and — if it writes files — the exact `paths` glob patterns it touches. Two tasks may run in the same `swarm_next` batch only when neither is in the other's `dependsOn` chain and their `paths` don't overlap; the scheduler enforces this for you (conservatively — see the swarm architecture's own lease-conflict heuristic, which errs toward serializing when in doubt), but a DAG that never expresses real dependencies just wastes the scheduler's conflict-blocking on tasks that should have been sequential from the start.

## The loop

1. `memory_search` the goal, then `rag_search` the goal. Read before trusting either.
2. `swarm_create`, then `task_create` with the full DAG.
3. Until `swarm_status` shows no non-terminal tasks:
   - `swarm_next({ swarmId })`.
   - Dispatch every entry in the batch via Claude Code's `Agent` tool, in one message if there's more than one (see `yandecode-worker-contract` for what each worker does with its `taskId`).
   - `message_read({ swarmId, toAgent: 'dispatcher' })`; answer any `question` with `message_send` before the next iteration if a worker is waiting on it.
4. Once terminal, `swarm_status` for the final tally, then `memory_store` anything genuinely worth keeping — most goals produce nothing worth storing; don't pollute future recall with obvious or weak facts.

## Failure

A task that fails and has attempts remaining goes back to `ready` on its own (the state machine handles retries) — it will simply reappear in a future `swarm_next` batch. A task that exhausts its attempts stays `failed`; decide whether the goal can proceed without it, needs a different approach, or should be reported to the user as blocked. Never resubmit the identical task unchanged and expect a different result.
