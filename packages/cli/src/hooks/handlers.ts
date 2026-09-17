import { appendFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { YandeCodeError, nowIso, resolveInsideRoot } from '@yandecode/core';
import { z } from 'zod';
import { tryOpenRuntime, type RuntimeContext } from '../context.js';
import { createSwarmRuntime } from '../swarm-runtime.js';

export const HookInputSchema = z
  .object({
    session_id: z.string().optional(),
    cwd: z.string().optional(),
    hook_event_name: z.string().optional(),
    source: z.string().optional(),
    reason: z.string().optional(),
    tool_name: z.string().optional(),
    tool_input: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export type HookInput = z.infer<typeof HookInputSchema>;

export interface HookOutput {
  stdout: string;
}

function sessionStartContext(rt: RuntimeContext): string {
  const counts = rt.index.counts();
  const dirty = rt.index.listDirty().length;
  const generation = rt.index.getMeta('repository')?.generation ?? 0;
  let text = `YandeCode: index ${counts.documents} documents / ${counts.chunks} chunks, ${dirty} dirty file(s), generation ${generation}. Use rag_search before exploring manually.`;
  if (counts.chunks === 0) text += ' Run "yandecode index" to build the index.';
  return text;
}

function toRelativePosix(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}

function extractAgentName(input: HookInput): string | null {
  const raw = input as Record<string, unknown>;
  const candidate = raw.agent_id ?? raw.subagent_id ?? raw.name;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function extractWorktreePath(input: HookInput): string | null {
  const raw = input as Record<string, unknown>;
  const candidate = raw.worktree_path ?? raw.path;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

export async function handleHook(
  event: string,
  rawInput: unknown,
  rt: RuntimeContext,
): Promise<HookOutput> {
  const parsed = HookInputSchema.safeParse(rawInput);
  const input: HookInput = parsed.success ? parsed.data : {};

  if (event === 'SessionStart') {
    await rt.sessions.start({
      claudeSessionId: input.session_id ?? null,
      cwd: input.cwd ?? rt.paths.root,
    });
    await rt.events.emit({ event: 'session_started', data: { source: input.source ?? 'unknown' } });
    const additionalContext = sessionStartContext(rt);
    return {
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
      }),
    };
  }

  if (event === 'PostToolUse') {
    const candidate = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (typeof candidate !== 'string') return { stdout: '' };
    let abs: string;
    try {
      abs = resolveInsideRoot(rt.paths.root, candidate);
    } catch (error) {
      if (error instanceof YandeCodeError && error.code === 'PATH_OUTSIDE_ROOT')
        return { stdout: '' };
      throw error;
    }
    const rel = toRelativePosix(rt.paths.root, abs);
    if (rel === '' || rel === '.yandecode' || rel.startsWith('.yandecode/')) return { stdout: '' };
    await rt.index.markDirty(rel, input.tool_name ?? 'unknown');
    await rt.events.emit({
      event: 'file_dirty',
      data: { path: rel, tool: input.tool_name ?? 'unknown' },
    });
    return { stdout: '' };
  }

  if (event === 'SessionEnd') {
    if (input.session_id) await rt.sessions.end(input.session_id, input.reason ?? 'unknown');
    const swarmRt = createSwarmRuntime(rt);
    const orphaned = swarmRt.swarmService.listActiveSwarmsForSession(input.session_id ?? null);
    for (const swarm of orphaned) {
      await swarmRt.swarmService.swarmCancel(swarm.id);
      await rt.events.emit({ event: 'swarm_orphaned_cancelled', data: { swarmId: swarm.id } });
    }
    await rt.events.emit({ event: 'session_ended', data: { reason: input.reason ?? 'unknown' } });
    return { stdout: '' };
  }

  if (event === 'SubagentStop') {
    const agentName = extractAgentName(input);
    if (agentName) {
      const swarmRt = createSwarmRuntime(rt);
      const task = swarmRt.swarmService.getTask(agentName);
      if (task && (task.status === 'claimed' || task.status === 'running')) {
        const to = task.status === 'claimed' ? 'cancelled' : 'failed';
        await swarmRt.swarmService.taskUpdate(task.id, to, {
          resultJson: JSON.stringify({ STATUS: to, SUMMARY: 'agent stopped without completing (SubagentStop)', EVIDENCE: [], FILES_TOUCHED: [], TESTS: [], RISKS: [], FOLLOW_UP: [] }),
        });
        await rt.events.emit({ event: 'task_orphaned', data: { taskId: task.id, reason: 'subagent_stop' } });
      }
    }
    return { stdout: '' };
  }

  if (event === 'WorktreeCreate' || event === 'WorktreeRemove') {
    const worktreePath = extractWorktreePath(input);
    if (worktreePath) {
      await rt.events.emit({ event: event === 'WorktreeCreate' ? 'worktree_created' : 'worktree_removed', data: { path: worktreePath } });
    }
    return { stdout: '' };
  }

  return { stdout: '' };
}

function logHookError(root: string, event: string, error: unknown): void {
  try {
    const dir = join(root, '.yandecode', 'logs');
    mkdirSync(dir, { recursive: true });
    const message = error instanceof Error ? error.message : String(error);
    appendFileSync(join(dir, 'hooks.log'), `${nowIso()} ${event} ${message}\n`, 'utf8');
  } catch {
    /* logging must never throw */
  }
}

export async function runHookCommand(
  event: string,
  stdinText: string,
  cwd: string,
): Promise<{ stdout: string; exitCode: 0 }> {
  let input: unknown;
  try {
    input = stdinText.trim() === '' ? {} : JSON.parse(stdinText);
  } catch {
    input = {};
  }
  let rt: RuntimeContext | null = null;
  try {
    rt = tryOpenRuntime(cwd);
    if (!rt) return { stdout: '', exitCode: 0 };
    const out = await handleHook(event, input, rt);
    return { stdout: out.stdout, exitCode: 0 };
  } catch (error) {
    if (rt) logHookError(rt.paths.root, event, error);
    return { stdout: '', exitCode: 0 };
  } finally {
    if (rt) {
      try {
        rt.close();
      } catch {
        /* close() failures must never escape */
      }
    }
  }
}
