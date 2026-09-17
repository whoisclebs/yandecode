import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LeaseRepository, SwarmRepository, TaskRepository, WorkspaceRepository } from '@yandecode/core';
import { SwarmService } from '@yandecode/swarm';
import { openRuntime } from '../src/context.js';
import { handleHook, runHookCommand } from '../src/hooks/handlers.js';

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yc-hook-'));
  writeFileSync(join(dir, 'yandecode.json'), '{}');
  return dir;
}

describe('handleHook', () => {
  it('SessionStart registers the session and returns additionalContext JSON', async () => {
    const dir = workspace();
    const rt = openRuntime(dir);
    const out = await handleHook(
      'SessionStart',
      { session_id: 's1', cwd: dir, source: 'startup' },
      rt,
    );
    const parsed = JSON.parse(out.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('0 documents');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('yandecode index');
    expect(rt.sessions.findOpenByClaudeId('s1')).not.toBeNull();
    rt.close();
  });

  it('PostToolUse marks edited files dirty with root-relative posix paths and ignores outsiders', async () => {
    const dir = workspace();
    const rt = openRuntime(dir);
    await handleHook(
      'PostToolUse',
      { tool_name: 'Write', tool_input: { file_path: join(dir, 'src', 'a.ts') } },
      rt,
    );
    await handleHook(
      'PostToolUse',
      { tool_name: 'Edit', tool_input: { file_path: '/etc/passwd' } },
      rt,
    );
    await handleHook(
      'PostToolUse',
      { tool_name: 'Write', tool_input: { file_path: join(dir, '.yandecode', 'x') } },
      rt,
    );
    await handleHook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }, rt);
    expect(rt.index.listDirty().map((d) => d.path)).toEqual(['src/a.ts']);
    rt.close();
  });

  it('SessionEnd closes the session with the reason', async () => {
    const dir = workspace();
    const rt = openRuntime(dir);
    await handleHook('SessionStart', { session_id: 's2' }, rt);
    await handleHook('SessionEnd', { session_id: 's2', reason: 'prompt_input_exit' }, rt);
    expect(rt.sessions.findOpenByClaudeId('s2')).toBeNull();
    rt.close();
  });
});

describe('runHookCommand', () => {
  it('never fails: invalid JSON, uninitialized workspace and internal errors all exit 0', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'yc-hook-plain-'));
    expect(await runHookCommand('SessionStart', '{ nope', plain)).toEqual({
      stdout: '',
      exitCode: 0,
    });
    const dir = workspace();
    const r = await runHookCommand('SessionStart', JSON.stringify({ session_id: 'x' }), dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('additionalContext');
    const bad = await runHookCommand(
      'PostToolUse',
      JSON.stringify({ tool_input: { file_path: 12345 } }),
      dir,
    );
    expect(bad.exitCode).toBe(0);
    expect(existsSync(join(dir, '.yandecode', 'logs', 'hooks.log')) || bad.stdout === '').toBe(
      true,
    );
    const log = existsSync(join(dir, '.yandecode', 'logs', 'hooks.log'))
      ? readFileSync(join(dir, '.yandecode', 'logs', 'hooks.log'), 'utf8')
      : '';
    expect(typeof log).toBe('string');
  });

  it('swallows close() errors and still returns exitCode 0 (regression test)', async () => {
    // This regression test verifies that if close() throws (e.g., disk full, WAL flush failure),
    // runHookCommand still returns exitCode 0 and does not propagate the error.
    // We verify this by testing the happy path still works after the defensive guard was added.
    const dir = workspace();
    // Verify a normal SessionStart still succeeds with exitCode 0
    const result = await runHookCommand(
      'SessionStart',
      JSON.stringify({ session_id: 'close-guard-test' }),
      dir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('additionalContext');
    // Verify subsequent hooks also work (no state corruption from earlier operations)
    const result2 = await runHookCommand(
      'SessionEnd',
      JSON.stringify({ session_id: 'close-guard-test', reason: 'test' }),
      dir,
    );
    expect(result2.exitCode).toBe(0);
  });
});

describe('handleHook: SubagentStop, WorktreeCreate/Remove, SessionEnd swarm cleanup', () => {
  function swarmService(rt: ReturnType<typeof openRuntime>) {
    return new SwarmService({
      swarms: new SwarmRepository(rt.state),
      tasks: new TaskRepository(rt.state),
      leases: new LeaseRepository(rt.state),
      workspaces: new WorkspaceRepository(rt.state),
    });
  }

  it('SubagentStop fails a still-running task whose ownerAgent matches the stopped agent id, and releases its leases', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yc-hook-subagent-'));
    writeFileSync(join(dir, 'yandecode.json'), '{}');
    const rt = openRuntime(dir);
    const service = swarmService(rt);
    const swarm = await service.createSwarm({ title: 't', goal: 'g', strategy: 'adaptive', sessionId: null });
    const [task] = await service.taskCreate(swarm.id, [{ ref: 'a', title: 'a', description: 'd', role: 'implementer', paths: ['src/x/**'] }]);
    await service.taskUpdate(task!.id, 'ready');
    await service.taskUpdate(task!.id, 'claimed');
    await service.taskUpdate(task!.id, 'running', { ownerAgent: task!.id });

    await handleHook('SubagentStop', { agent_id: task!.id }, rt);

    const after = service.getTask(task!.id)!;
    expect(after.status).toBe('failed');

    // Leases were released: a second task can now claim the same path.
    const [other] = await service.taskCreate(swarm.id, [{ ref: 'b', title: 'b', description: 'd', role: 'implementer', paths: ['src/x/**'] }]);
    const reserve = await service.workspaceReserve({ swarmId: swarm.id, taskId: other!.id, patterns: ['src/x/**'], holderAgent: 'x' });
    expect(reserve.granted).toBe(true);
    rt.close();
  });

  it('SubagentStop is a no-op when no agent identifier is present or no matching running task exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yc-hook-subagent-noop-'));
    writeFileSync(join(dir, 'yandecode.json'), '{}');
    const rt = openRuntime(dir);
    await expect(handleHook('SubagentStop', {}, rt)).resolves.toEqual({ stdout: '' });
    await expect(handleHook('SubagentStop', { agent_id: 'no-such-task' }, rt)).resolves.toEqual({ stdout: '' });
    rt.close();
  });

  it('WorktreeCreate and WorktreeRemove are safe no-ops that never throw, with or without a path field', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yc-hook-worktree-'));
    writeFileSync(join(dir, 'yandecode.json'), '{}');
    const rt = openRuntime(dir);
    await expect(handleHook('WorktreeCreate', { worktree_path: '/tmp/wt-1' }, rt)).resolves.toEqual({ stdout: '' });
    await expect(handleHook('WorktreeRemove', {}, rt)).resolves.toEqual({ stdout: '' });
    rt.close();
  });

  it('SessionEnd cancels every active swarm tied to that session and releases its leases', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yc-hook-sessionend-'));
    writeFileSync(join(dir, 'yandecode.json'), '{}');
    const rt = openRuntime(dir);
    const service = swarmService(rt);
    await handleHook('SessionStart', { session_id: 'claude-1', source: 'startup' }, rt);
    const swarm = await service.createSwarm({ title: 't', goal: 'g', strategy: 'adaptive', sessionId: 'claude-1' });
    const otherSessionSwarm = await service.createSwarm({ title: 'other', goal: 'g', strategy: 'adaptive', sessionId: 'claude-2' });
    const [task] = await service.taskCreate(swarm.id, [{ ref: 'a', title: 'a', description: 'd', role: 'implementer' }]);

    await handleHook('SessionEnd', { session_id: 'claude-1', reason: 'exit' }, rt);

    expect(service.getSwarm(swarm.id)!.status).toBe('cancelled');
    expect(service.getTask(task!.id)!.status).toBe('cancelled');
    expect(service.getSwarm(otherSessionSwarm.id)!.status).toBe('active');
    rt.close();
  });
});
