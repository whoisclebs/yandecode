---
name: yandecode-delegation
description: How the YandeCode dispatcher decomposes work and delegates to yandecode-* subagents with Claude Code's Agent tool. Use whenever a goal may need a scout, parallel workers, tests or review.
---

# YandeCode Delegation

Claude Code executes. You decide who does what.

## Decide before delegating
| Situation | Action |
|---|---|
| Simple task | do it directly |
| Unknown repository area | `yandecode-scout` first |
| Several independent items | parallel `yandecode-implementer` workers |
| Dependent items | sequential, one at a time |
| Risky change | `yandecode-reviewer`; `yandecode-security` when the area matches its scope |

## Parallelism checklist
Before spawning two workers at once, confirm: no dependency between them, no shared files, no shared component, no shared mutable resource, no shared context requirement. If any is true, do not parallelize.

## Spawning
- Use the Agent tool with `subagent_type` = the agent name (e.g. `yandecode-implementer`).
- Spawn all independent workers in ONE message with `run_in_background: true`.
- Give each worker: the goal, the exact paths it may write, the acceptance criteria, and the output contract (STATUS, SUMMARY, EVIDENCE, FILES_TOUCHED, TESTS, RISKS, FOLLOW_UP).
- Use `isolation: "worktree"` when two workers write code concurrently. Merging their branches is your explicit step afterwards, never automatic.
- Keep at most 4 concurrent workers; never more than 8.

## After results
Do not poll. When a worker's notification arrives, read its structured result, verify the key claims with `Read` or by running tests, and continue. Never accept "done" without evidence.

## Failure
If a worker fails twice on the same item, do not resend the same prompt. Replan, split the item, change approach, or ask the user.
