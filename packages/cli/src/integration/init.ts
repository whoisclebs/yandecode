import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  StateService,
  ensureWorkspaceDirs,
  workspacePathsFor,
  writeDefaultConfig,
  writeFileAtomic,
} from '@yandecode/core';
import { resolveLauncher, type Launcher } from '../launcher.js';
import { loadPluginContent } from '../plugin-content.js';
import { VERSION } from '../version.js';
import { claudeMdBlock, upsertBlock } from './claude-md.js';
import { ensureGitignoreEntry } from './gitignore.js';
import { readJsonSafe } from './json-utils.js';
import { readManifest, writeManifest, type ManagedFile } from './manifest.js';
import { materializeFile, type MaterializeResult } from './materialize.js';
import { addMcpServer } from './mcp-config.js';
import { hookEntriesFor, mergeHooks } from './settings.js';

export interface InitOptions {
  force?: boolean;
  launcher?: Launcher;
}

export interface InitReport {
  root: string;
  files: MaterializeResult[];
  configCreated: boolean;
  settingsUpdated: boolean;
  mcpUpdated: boolean;
  claudeMdUpdated: boolean;
  gitignoreUpdated: boolean;
}

function writeJsonIfChanged(file: string, next: Record<string, unknown>): boolean {
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return false;
  writeFileAtomic(file, text);
  return true;
}

function writeTextIfChanged(file: string, next: string): boolean {
  if (existsSync(file) && readFileSync(file, 'utf8') === next) return false;
  writeFileAtomic(file, next);
  return true;
}

export function runInit(cwd: string, options: InitOptions = {}): Promise<InitReport> {
  const root = cwd;
  const paths = workspacePathsFor(root);
  const launcher = options.launcher ?? resolveLauncher();
  const force = options.force ?? false;
  const plugin = loadPluginContent();

  const configCreated = writeDefaultConfig(root);
  ensureWorkspaceDirs(paths);
  StateService.open(paths.stateDb).close();

  const previous = readManifest(paths.managedManifest);
  const prevByPath = new Map<string, ManagedFile>((previous?.files ?? []).map((f) => [f.path, f]));

  const files: MaterializeResult[] = [];
  for (const agent of plugin.agents) {
    const rel = `.claude/agents/${agent.name}.md`;
    files.push(
      materializeFile(root, rel, readFileSync(agent.file, 'utf8'), prevByPath.get(rel), force),
    );
  }
  for (const skill of plugin.skills) {
    const rel = `.claude/skills/${skill.name}/SKILL.md`;
    files.push(
      materializeFile(root, rel, readFileSync(skill.file, 'utf8'), prevByPath.get(rel), force),
    );
  }

  const settingsFile = join(root, '.claude', 'settings.json');
  const entries = hookEntriesFor(launcher, JSON.parse(readFileSync(plugin.hooksFile, 'utf8')));
  const settingsUpdated = writeJsonIfChanged(
    settingsFile,
    mergeHooks(readJsonSafe(settingsFile, {}), entries),
  );

  const mcpFile = join(root, '.mcp.json');
  const mcpUpdated = writeJsonIfChanged(mcpFile, addMcpServer(readJsonSafe(mcpFile, {}), launcher));

  const claudeMd = join(root, 'CLAUDE.md');
  const claudeMdUpdated = writeTextIfChanged(
    claudeMd,
    upsertBlock(existsSync(claudeMd) ? readFileSync(claudeMd, 'utf8') : '', claudeMdBlock()),
  );

  const gitignore = join(root, '.gitignore');
  const gitignoreUpdated = writeTextIfChanged(
    gitignore,
    ensureGitignoreEntry(
      existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '',
      '.yandecode/',
    ),
  );

  const manifestFiles: ManagedFile[] = [];
  for (const f of files) {
    if (f.action === 'preserved') {
      // A preserved file with no previous manifest entry has no known "managed"
      // content hash to record: f.hash here is the USER'S OWN content hash, and
      // recording it would make a later init/uninstall mistake the user's edit
      // for untouched managed content (see Fix 2 regression test). Omit it so
      // the next run again sees `previous === undefined` and treats it as
      // unmanaged/preserved, exactly like today.
      const prev = prevByPath.get(f.path);
      if (prev) manifestFiles.push({ path: f.path, hash: prev.hash });
      continue;
    }
    manifestFiles.push({ path: f.path, hash: f.hash });
  }

  writeManifest(paths.managedManifest, {
    version: VERSION,
    files: manifestFiles,
  });

  return Promise.resolve({
    root,
    files,
    configCreated,
    settingsUpdated,
    mcpUpdated,
    claudeMdUpdated,
    gitignoreUpdated,
  });
}
