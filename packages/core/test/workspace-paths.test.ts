import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureWorkspaceDirs,
  resolveWorkspace,
  userCacheDir,
  workspacePathsFor,
} from '../src/workspace/paths.js';

describe('workspace paths', () => {
  it('derives all paths from root', () => {
    const p = workspacePathsFor('/repo');
    expect(p).toEqual({
      root: '/repo',
      configFile: '/repo/yandecode.json',
      yandecodeDir: '/repo/.yandecode',
      stateDb: '/repo/.yandecode/state.db',
      managedManifest: '/repo/.yandecode/managed.json',
      indexesDir: '/repo/.yandecode/indexes',
      cacheDir: '/repo/.yandecode/cache',
      logsDir: '/repo/.yandecode/logs',
      runtimeDir: '/repo/.yandecode/runtime',
    });
  });

  it('resolveWorkspace walks up to the directory containing yandecode.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'yc-ws-'));
    writeFileSync(join(root, 'yandecode.json'), '{}');
    const nested = join(root, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(resolveWorkspace(nested)?.root).toBe(root);
  });

  it('resolveWorkspace returns null when no yandecode.json exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'yc-ws-none-'));
    expect(resolveWorkspace(root)).toBeNull();
  });

  it('ensureWorkspaceDirs creates the .yandecode tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'yc-ws-dirs-'));
    const p = workspacePathsFor(root);
    ensureWorkspaceDirs(p);
    for (const dir of [p.yandecodeDir, p.indexesDir, p.cacheDir, p.logsDir, p.runtimeDir]) {
      expect(existsSync(dir)).toBe(true);
    }
  });

  it('userCacheDir honours env and platform precedence', () => {
    expect(userCacheDir({ YANDECODE_CACHE_DIR: '/x' }, 'linux', '/home/u')).toBe('/x');
    expect(userCacheDir({ XDG_CACHE_HOME: '/xdg' }, 'linux', '/home/u')).toBe('/xdg/yandecode');
    expect(userCacheDir({}, 'linux', '/home/u')).toBe('/home/u/.cache/yandecode');
    expect(userCacheDir({}, 'darwin', '/Users/u')).toBe('/Users/u/Library/Caches/yandecode');
    expect(userCacheDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\Users\\u')).toBe(
      join('C:\\Users\\u\\AppData\\Local', 'yandecode'),
    );
  });
});
