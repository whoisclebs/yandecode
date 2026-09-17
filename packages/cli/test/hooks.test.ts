import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
    const out = await handleHook('SessionStart', { session_id: 's1', cwd: dir, source: 'startup' }, rt);
    const parsed = JSON.parse(out.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('0 documents');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('yandecode index');
    expect(rt.sessions.findOpenByClaudeId('s1')).not.toBeNull();
    rt.close();
  });

  it('PostToolUse marks edited files dirty with root-relative posix paths and ignores outsiders', async () => {
    const dir = workspace();
    const rt = openRuntime(dir);
    await handleHook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: join(dir, 'src', 'a.ts') } }, rt);
    await handleHook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: '/etc/passwd' } }, rt);
    await handleHook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: join(dir, '.yandecode', 'x') } }, rt);
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
    expect(await runHookCommand('SessionStart', '{ nope', plain)).toEqual({ stdout: '', exitCode: 0 });
    const dir = workspace();
    const r = await runHookCommand('SessionStart', JSON.stringify({ session_id: 'x' }), dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('additionalContext');
    const bad = await runHookCommand('PostToolUse', JSON.stringify({ tool_input: { file_path: 12345 } }), dir);
    expect(bad.exitCode).toBe(0);
    expect(existsSync(join(dir, '.yandecode', 'logs', 'hooks.log')) || bad.stdout === '').toBe(true);
    const log = existsSync(join(dir, '.yandecode', 'logs', 'hooks.log')) ? readFileSync(join(dir, '.yandecode', 'logs', 'hooks.log'), 'utf8') : '';
    expect(typeof log).toBe('string');
  });
});
