import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runInit } from '../src/integration/init.js';
import { runUninstall } from '../src/integration/uninstall.js';

const launcher = { command: 'yandecode', args: [] };
const tmp = (): string => mkdtempSync(join(tmpdir(), 'yc-init-'));
const readJson = (f: string): Record<string, unknown> => JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;

describe('runInit', () => {
  it('materializes agents, skills, hooks, mcp, CLAUDE.md, gitignore and manifest in a clean repo', async () => {
    const root = tmp();
    const report = await runInit(root, { launcher });
    expect(report.configCreated).toBe(true);
    expect(existsSync(join(root, 'yandecode.json'))).toBe(true);
    expect(existsSync(join(root, '.yandecode', 'state.db'))).toBe(true);
    expect(readdirSync(join(root, '.claude', 'agents')).sort()).toEqual([
      'yandecode-dispatcher.md', 'yandecode-implementer.md', 'yandecode-researcher.md', 'yandecode-reviewer.md',
      'yandecode-scout.md', 'yandecode-security.md', 'yandecode-tester.md',
    ]);
    expect(existsSync(join(root, '.claude', 'skills', 'yandecode-context-rules', 'SKILL.md'))).toBe(true);
    const settings = readJson(join(root, '.claude', 'settings.json'));
    expect(Object.keys(settings.hooks as object)).toEqual(['SessionStart', 'PostToolUse', 'SessionEnd']);
    const mcp = readJson(join(root, '.mcp.json'));
    expect((mcp.mcpServers as Record<string, unknown>).yandecode).toEqual({ command: 'yandecode', args: ['mcp', 'serve'] });
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toContain('<!-- yandecode:start -->');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.yandecode/');
    const manifest = readJson(join(root, '.yandecode', 'managed.json')) as { files: { path: string }[] };
    expect(manifest.files.map((f) => f.path)).toContain('.claude/agents/yandecode-scout.md');
    expect(manifest.files).toHaveLength(9);
  });

  it('is idempotent and preserves user edits and foreign config', async () => {
    const root = tmp();
    writeFileSync(join(root, 'CLAUDE.md'), '# Mine\n');
    writeFileSync(join(root, '.gitignore'), 'dist/\n');
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    await runInit(root, { launcher });
    writeFileSync(join(root, '.claude', 'agents', 'yandecode-scout.md'), '---\nname: yandecode-scout\n---\nmy version');
    const second = await runInit(root, { launcher });
    expect(second.configCreated).toBe(false);
    expect(second.files.find((f) => f.path === '.claude/agents/yandecode-scout.md')?.action).toBe('preserved');
    expect(second.files.filter((f) => f.action === 'unchanged')).toHaveLength(8);
    expect(readFileSync(join(root, '.claude', 'agents', 'yandecode-scout.md'), 'utf8')).toContain('my version');
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8').match(/yandecode:start/g)).toHaveLength(1);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toMatch(/^# Mine\n/);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('dist/\n.yandecode/\n');
    expect((readJson(join(root, '.mcp.json')).mcpServers as Record<string, unknown>).other).toEqual({ command: 'x' });
    const third = await runInit(root, { launcher, force: true });
    expect(third.files.find((f) => f.path === '.claude/agents/yandecode-scout.md')?.action).toBe('updated');
  });
});

describe('runUninstall', () => {
  it('removes exactly what init created and leaves the rest', async () => {
    const root = tmp();
    writeFileSync(join(root, 'CLAUDE.md'), '# Mine\n');
    writeFileSync(join(root, '.gitignore'), 'dist/\n');
    writeFileSync(join(root, 'README.md'), 'keep');
    await runInit(root, { launcher });
    writeFileSync(join(root, '.claude', 'agents', 'mine.md'), 'user agent');
    const report = await runUninstall(root);
    expect(report.removed).toContain('.claude/agents/yandecode-scout.md');
    expect(existsSync(join(root, '.claude', 'agents', 'yandecode-scout.md'))).toBe(false);
    expect(existsSync(join(root, '.claude', 'agents', 'mine.md'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'skills', 'yandecode-context-rules'))).toBe(false);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('# Mine\n');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('dist/\n');
    expect(readJson(join(root, '.claude', 'settings.json')).hooks).toBeUndefined();
    expect((readJson(join(root, '.mcp.json')).mcpServers as Record<string, unknown>).yandecode).toBeUndefined();
    expect(existsSync(join(root, 'yandecode.json'))).toBe(false);
    expect(existsSync(join(root, '.yandecode', 'state.db'))).toBe(true);
    expect(existsSync(join(root, '.yandecode', 'managed.json'))).toBe(false);
    expect(report.purged).toBe(false);
  });

  it('skips user-edited managed files and purges .yandecode on request', async () => {
    const root = tmp();
    await runInit(root, { launcher });
    writeFileSync(join(root, '.claude', 'agents', 'yandecode-scout.md'), 'edited');
    const report = await runUninstall(root, { purge: true });
    expect(report.skipped).toEqual(['.claude/agents/yandecode-scout.md']);
    expect(existsSync(join(root, '.claude', 'agents', 'yandecode-scout.md'))).toBe(true);
    expect(existsSync(join(root, '.yandecode'))).toBe(false);
    expect(report.purged).toBe(true);
  });
});
