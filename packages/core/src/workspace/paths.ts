import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CONFIG_FILENAME } from '../config/schema.js';

export interface WorkspacePaths {
  root: string;
  configFile: string;
  yandecodeDir: string;
  stateDb: string;
  managedManifest: string;
  indexesDir: string;
  cacheDir: string;
  logsDir: string;
  runtimeDir: string;
}

export function workspacePathsFor(root: string): WorkspacePaths {
  const yandecodeDir = join(root, '.yandecode');
  return {
    root,
    configFile: join(root, CONFIG_FILENAME),
    yandecodeDir,
    stateDb: join(yandecodeDir, 'state.db'),
    managedManifest: join(yandecodeDir, 'managed.json'),
    indexesDir: join(yandecodeDir, 'indexes'),
    cacheDir: join(yandecodeDir, 'cache'),
    logsDir: join(yandecodeDir, 'logs'),
    runtimeDir: join(yandecodeDir, 'runtime'),
  };
}

export function resolveWorkspace(cwd: string): WorkspacePaths | null {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILENAME))) return workspacePathsFor(dir);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function ensureWorkspaceDirs(paths: WorkspacePaths): void {
  for (const dir of [
    paths.yandecodeDir,
    paths.indexesDir,
    paths.cacheDir,
    paths.logsDir,
    paths.runtimeDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
}

export function userCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.YANDECODE_CACHE_DIR) return env.YANDECODE_CACHE_DIR;
  if (platform === 'win32' && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'yandecode');
  if (env.XDG_CACHE_HOME) return join(env.XDG_CACHE_HOME, 'yandecode');
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'yandecode');
  return join(home, '.cache', 'yandecode');
}
