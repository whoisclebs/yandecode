# ADR-012: Conservative lease conflicts; worktrees only when concurrent writers collide

Status: accepted (2026-09-17)

## Context

Multiple swarm tasks can run as concurrent Claude Code subagents. Two tasks writing
overlapping paths in the same working tree race each other's edits; two tasks writing
disjoint paths in the same working tree are safe and should run there — spinning up a
git worktree per task regardless of overlap would cost setup time and disk for the
common case where no worktree is actually needed.

## Decision

`leaseConflicts` (`packages/swarm/src/scheduler/leases.ts`) is a glob segment-prefix
heuristic and is deliberately conservative: it is allowed to report a conflict between
two patterns that would not, in fact, ever match the same file, but it must never miss
a real conflict (see the mid-segment-wildcard fix in Task 3 of this plan, which
tightened this guarantee after an initial gap). Leases are acquired when a task enters
`running` (not `claimed`, which can be released without ever touching a file), have a
15-minute TTL. `LeaseRepository.renew()` exists at the persistence layer but v0 exposes
no MCP tool or CLI surface for a worker to actually call it — a long-running task's
lease is not renewed and can expire before the task finishes; `SwarmService.swarmNext`
stays safe regardless, since it unions real active leases with the paths of every
`claimed`/`running` task when computing conflicts, so an expired-but-still-in-progress
lease's path is not handed out to a second task even after expiry. A dedicated renewal
tool is a natural, small follow-up, not implemented in this pass. Leases are released
on task completion,
failure, or a `SubagentStop`/`SessionEnd` hook firing for an orphaned owner. The
scheduler (`Scheduler.scheduleNext`) sets `needsWorktree: true` on a `SpawnRequest`
batch only when it selects two or more path-writing tasks together in the same tick —
a single selected writer, or a batch of purely read-only tasks (scout, reviewer,
security, researcher), never needs one. When `needsWorktree` is set, the dispatcher is
responsible for creating the isolated workspace (via `superpowers:using-git-worktrees`
or Claude Code's native worktree tooling) before spawning those workers, and for
merging or discarding the result afterward — the swarm layer tracks a `workspaces` row
per reservation (Task 4) but never runs git itself.

## Alternatives considered

- Every task gets its own worktree unconditionally: simplest to reason about, but pays
  worktree setup/teardown cost even for the overwhelmingly common case (a swarm of
  read-only scout/reviewer tasks, or a single implementer) where it buys nothing.
  Rejected for v0.
- A precise (non-conservative) glob-intersection algorithm instead of the segment-prefix
  heuristic: correctly permits more concurrency, but is materially harder to get right
  and to verify, for a payoff (slightly more parallelism) that matters only once v0 is
  actually running many-task swarms in practice. Deferred past v0 — the segment-prefix
  heuristic's only failure mode is over-serializing, never a race.

## Consequences

v0 undercounts safe parallelism in exchange for a simple, verifiably-safe conflict
check and no accidental worktree sprawl. A swarm with many small, narrowly-pathed tasks
will serialize more than a precise checker would allow; this is a deliberate,
documented tradeoff, not an oversight.
