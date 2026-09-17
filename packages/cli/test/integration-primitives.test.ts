import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '@yandecode/core';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MD_END,
  CLAUDE_MD_START,
  claudeMdBlock,
  removeBlock,
  upsertBlock,
} from '../src/integration/claude-md.js';
import { ensureGitignoreEntry, removeGitignoreEntry } from '../src/integration/gitignore.js';
import { readManifest, writeManifest } from '../src/integration/manifest.js';
import { materializeFile } from '../src/integration/materialize.js';
import { addMcpServer, removeMcpServer } from '../src/integration/mcp-config.js';
import { hookEntriesFor, mergeHooks, removeHooks } from '../src/integration/settings.js';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'yc-int-'));

describe('manifest', () => {
  it('round-trips and returns null when missing', () => {
    const file = join(tmp(), 'managed.json');
    expect(readManifest(file)).toBeNull();
    writeManifest(file, { version: '0.1.0', files: [{ path: '.claude/agents/x.md', hash: 'h' }] });
    expect(readManifest(file)).toEqual({
      version: '0.1.0',
      files: [{ path: '.claude/agents/x.md', hash: 'h' }],
    });
  });
});

describe('materializeFile', () => {
  it('creates, then reports unchanged, then updates when content changes', () => {
    const root = tmp();
    const a = materializeFile(root, '.claude/agents/x.md', 'v1', undefined, false);
    expect(a.action).toBe('created');
    expect(readFileSync(join(root, '.claude/agents/x.md'), 'utf8')).toBe('v1');
    const prev = { path: '.claude/agents/x.md', hash: sha256('v1') };
    expect(materializeFile(root, '.claude/agents/x.md', 'v1', prev, false).action).toBe(
      'unchanged',
    );
    expect(materializeFile(root, '.claude/agents/x.md', 'v2', prev, false).action).toBe('updated');
  });

  it('preserves a user-edited file unless forced', () => {
    const root = tmp();
    materializeFile(root, 'x.md', 'v1', undefined, false);
    writeFileSync(join(root, 'x.md'), 'user edit');
    const prev = { path: 'x.md', hash: sha256('v1') };
    expect(materializeFile(root, 'x.md', 'v2', prev, false).action).toBe('preserved');
    expect(readFileSync(join(root, 'x.md'), 'utf8')).toBe('user edit');
    expect(materializeFile(root, 'x.md', 'v2', prev, true).action).toBe('updated');
    expect(readFileSync(join(root, 'x.md'), 'utf8')).toBe('v2');
  });

  it('refuses paths outside the root', () => {
    expect(() => materializeFile(tmp(), '../evil.md', 'x', undefined, false)).toThrow(
      /PATH_OUTSIDE_ROOT/,
    );
  });
});

describe('settings hooks merge', () => {
  const pluginHooks = {
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: 'yandecode hook SessionStart', timeout: 10 }] },
      ],
      PostToolUse: [
        {
          matcher: 'Write|Edit',
          hooks: [{ type: 'command', command: 'yandecode hook PostToolUse', timeout: 10 }],
        },
      ],
    },
  };

  it('rewrites commands for the npx launcher', () => {
    const entries = hookEntriesFor({ command: 'npx', args: ['yandecode'] }, pluginHooks);
    const group = entries.SessionStart?.[0] as { hooks: { command: string }[] };
    expect(group.hooks[0]?.command).toBe('npx yandecode hook SessionStart');
  });

  it('merges without touching foreign hooks and is idempotent', () => {
    const entries = hookEntriesFor({ command: 'yandecode', args: [] }, pluginHooks);
    const settings = {
      permissions: { allow: ['Bash(npm test)'] },
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
    };
    const once = mergeHooks(settings, entries);
    const twice = mergeHooks(once, entries);
    expect(twice).toEqual(once);
    const ss = (once.hooks as Record<string, unknown[]>).SessionStart;
    expect(ss).toHaveLength(2);
    expect(once.permissions).toEqual({ allow: ['Bash(npm test)'] });
    const removed = removeHooks(once);
    expect((removed.hooks as Record<string, unknown[]>).SessionStart).toEqual([
      { hooks: [{ type: 'command', command: 'echo hi' }] },
    ]);
    expect((removed.hooks as Record<string, unknown[]>).PostToolUse).toBeUndefined();
  });
});

describe('mcp config', () => {
  it('adds and removes the yandecode server, preserving others', () => {
    const base = { mcpServers: { other: { command: 'x' } } };
    const added = addMcpServer(base, { command: 'npx', args: ['yandecode'] });
    expect((added.mcpServers as Record<string, unknown>).yandecode).toEqual({
      command: 'npx',
      args: ['yandecode', 'mcp', 'serve'],
    });
    expect((added.mcpServers as Record<string, unknown>).other).toEqual({ command: 'x' });
    const removed = removeMcpServer(added);
    expect((removed.mcpServers as Record<string, unknown>).yandecode).toBeUndefined();
    expect(addMcpServer({}, { command: 'yandecode', args: [] })).toEqual({
      mcpServers: { yandecode: { command: 'yandecode', args: ['mcp', 'serve'] } },
    });
  });
});

describe('CLAUDE.md block', () => {
  it('appends, replaces in place and removes', () => {
    const block = claudeMdBlock();
    expect(block.startsWith(CLAUDE_MD_START)).toBe(true);
    expect(block.trimEnd().endsWith(CLAUDE_MD_END)).toBe(true);
    const appended = upsertBlock('# My project\n', block);
    expect(appended).toBe(`# My project\n\n${block}\n`);
    const replaced = upsertBlock(
      `intro\n${CLAUDE_MD_START}\nold\n${CLAUDE_MD_END}\noutro\n`,
      block,
    );
    expect(replaced).toBe(`intro\n${block}\noutro\n`);
    expect(removeBlock(replaced)).toBe('intro\noutro\n');
    expect(upsertBlock('', block)).toBe(`${block}\n`);
  });
});

describe('gitignore', () => {
  it('adds once and removes exactly the entry', () => {
    expect(ensureGitignoreEntry('node_modules/\n', '.yandecode/')).toBe(
      'node_modules/\n.yandecode/\n',
    );
    expect(ensureGitignoreEntry('node_modules/\n.yandecode/\n', '.yandecode/')).toBe(
      'node_modules/\n.yandecode/\n',
    );
    expect(ensureGitignoreEntry('node_modules/', '.yandecode/')).toBe(
      'node_modules/\n.yandecode/\n',
    );
    expect(removeGitignoreEntry('node_modules/\n.yandecode/\ndist/\n', '.yandecode/')).toBe(
      'node_modules/\ndist/\n',
    );
  });
});
