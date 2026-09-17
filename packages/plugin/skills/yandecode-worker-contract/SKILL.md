---
name: yandecode-worker-contract
description: The claim, run, report lifecycle every yandecode-* worker follows once the dispatcher spawns it with a taskId inside a swarm. Use whenever your dispatch prompt includes a taskId and swarmId.
---

# YandeCode Worker Contract

You were spawned with a `taskId` and `swarmId` in your prompt. The swarm state you update through these MCP tools is a separate channel from your `Agent`-tool return value — both are required, and they serve different readers: `task_update` is for the scheduler and your sibling tasks' dependencies; your STATUS/SUMMARY/EVIDENCE report is for the dispatcher's own judgment.

## 1. Claim

`task_update({ taskId, status: 'claimed' })`.

If your task carries `paths` (you'll write files), reserve them before touching anything: `workspace_reserve({ swarmId, taskId, patterns: <your paths>, holderAgent: taskId })`. If `granted` comes back `false`, another task holds a conflicting lease — do not fight over it: `task_update({ taskId, status: 'cancelled' })` (a `claimed` task can only move to `running` or `cancelled` — there is no `blocked` state to retreat to from here) and stop; report this as your `FOLLOW_UP` so the dispatcher can re-ready you once the conflict clears, per `yandecode-swarm-protocol`'s Failure section.

## 2. Start

`task_update({ taskId, status: 'running', ownerAgent: taskId })`.

## 3. Orient

`memory_search` your task's own title/description for prior decisions, patterns, solutions or failures in this area, and `rag_search` for the code itself. Both are leads, not authority — `Read` before relying on either, per `yandecode-context-rules`.

## 4. Work

Do the task, following your own agent's normal procedure (TDD for `implementer`/`tester`; read-only analysis, never edits, for `scout`/`reviewer`/`security`/`researcher`). Stay inside the `paths` you reserved; if you must touch something outside them, stop and report it as `FOLLOW_UP` instead of editing.

## 5. Communicate mid-task

If you hit something the dispatcher or a sibling task needs to know before you finish — a blocking question, a dependency you didn't expect, a security finding — send it immediately, don't sit on it until the end: `message_send({ swarmId, from: taskId, to: 'dispatcher', type: 'question' | 'finding' | 'dependency' | 'warning', payload })`.

If you sent a `question` and genuinely cannot proceed without the answer, poll for it with `message_read({ swarmId, toAgent: taskId })` before continuing — the dispatcher's `answer` is addressed to your own `taskId`, not broadcast, so nothing else will surface it to you.

## 6. Finish

`workspace_release({ taskId })` if you reserved paths.

**Always call `task_update({ taskId, status: 'completed' | 'failed', resultJson: <compact JSON summary> })` yourself, on every exit path — including inside error handling, before you stop for any reason.** This is the reliable mechanism for reporting your outcome. A `SubagentStop` hook exists as a best-effort backstop for the case where you're killed or crash before you can self-report, but it depends on Claude Code hook payload fields that aren't fully verified — do not rely on it as your primary reporting path. A task left at `running` with no self-report blocks every task that depends on it, potentially forever.

## 7. Learn

If you found something genuinely reusable beyond "I did the task" — a real pattern, a solution to a non-obvious problem, a failure mode worth remembering — `memory_store({ namespace, content, evidence: taskId, confidence })`. Evidence is mandatory; the write policy rejects content without it. Be honest about `confidence` (0.5 default; only go higher when you have real proof it generalizes beyond this one task).

## 8. Report

Return your normal output contract (STATUS, SUMMARY, EVIDENCE, FILES_TOUCHED, TESTS, RISKS, FOLLOW_UP) as your `Agent` tool result, exactly as you would outside a swarm.
