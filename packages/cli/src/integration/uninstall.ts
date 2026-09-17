import { existsSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveInsideRoot, sha256, workspacePathsFor, writeFileAtomic } from '@yandecode/core';
import { removeBlock } from './claude-md.js';
import { removeGitignoreEntry } from './gitignore.js';
import { readManifest } from './manifest.js';
import { removeMcpServer } from './mcp-config.js';
import { removeHooks } from './settings.js';

export interface UninstallOptions {
  purge?: boolean;
}

export interface UninstallReport {
  removed: string[];
  skipped: string[];
  purged: boolean;
}

function removeEmptyDirsUpTo(dir: string, stopAt: string): void {
  let current = dir;
  while (current.startsWith(stopAt) && current !== stopAt) {
    if (!existsSync(current) || readdirSync(current).length > 0) return;
    rmSync(current, { recursive: true });
    current = dirname(current);
  }
}

export function runUninstall(
  cwd: string,
  options: UninstallOptions = {},
): Promise<UninstallReport> {
  const root = cwd;
  const paths = workspacePathsFor(root);
  const manifest = readManifest(paths.managedManifest);
  const removed: string[] = [];
  const skipped: string[] = [];

  for (const file of manifest?.files ?? []) {
    const abs = resolveInsideRoot(root, file.path);
    if (!existsSync(abs)) continue;
    if (sha256(readFileSync(abs)) !== file.hash) {
      skipped.push(file.path);
      continue;
    }
    unlinkSync(abs);
    removed.push(file.path);
    removeEmptyDirsUpTo(dirname(abs), join(root, '.claude'));
  }

  const settingsFile = join(root, '.claude', 'settings.json');
  if (existsSync(settingsFile)) {
    const next = removeHooks(
      JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, unknown>,
    );
    writeFileAtomic(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
  }

  const mcpFile = join(root, '.mcp.json');
  if (existsSync(mcpFile)) {
    const next = removeMcpServer(
      JSON.parse(readFileSync(mcpFile, 'utf8')) as Record<string, unknown>,
    );
    writeFileAtomic(mcpFile, `${JSON.stringify(next, null, 2)}\n`);
  }

  const claudeMd = join(root, 'CLAUDE.md');
  if (existsSync(claudeMd)) writeFileAtomic(claudeMd, removeBlock(readFileSync(claudeMd, 'utf8')));

  const gitignore = join(root, '.gitignore');
  if (existsSync(gitignore))
    writeFileAtomic(
      gitignore,
      removeGitignoreEntry(readFileSync(gitignore, 'utf8'), '.yandecode/'),
    );

  if (existsSync(paths.configFile)) unlinkSync(paths.configFile);

  const purged = options.purge ?? false;
  if (purged) rmSync(paths.yandecodeDir, { recursive: true, force: true });
  else if (existsSync(paths.managedManifest)) unlinkSync(paths.managedManifest);

  return Promise.resolve({ removed, skipped, purged });
}
