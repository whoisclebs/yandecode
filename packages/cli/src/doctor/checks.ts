import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SCHEMA_VERSION,
  loadConfig,
  openDatabase,
  resolveInsideRoot,
  resolveWorkspace,
  schemaVersion,
  sha256,
} from '@yandecode/core';
import {
  listGenerations,
  modelIsCached,
  resolveModelCacheDir,
  USearchVectorIndex,
} from '@yandecode/retrieval';
import { CLAUDE_MD_START } from '../integration/claude-md.js';
import { isMalformedJson, readJsonSafe } from '../integration/json-utils.js';
import { readManifest } from '../integration/manifest.js';
import { HOOK_EVENTS } from '../plugin-content.js';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface DoctorDeps {
  cwd: string;
  probeVersion: (cmd: string, args: string[]) => string | null;
  nodeVersion: string;
  yandecodeVersion: string;
}

export function defaultProbeVersion(cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: 5000,
    shell: process.platform === 'win32',
  });
  return r.status === 0 ? r.stdout.trim() : null;
}

const INIT_FIX = 'yandecode init';

function toolCheck(
  name: string,
  cmd: string,
  probe: DoctorDeps['probeVersion'],
  fix: string,
): CheckResult {
  const v = probe(cmd, ['--version']);
  return v
    ? { name, status: 'ok', detail: v.split('\n')[0] ?? v }
    : { name, status: 'fail', detail: `${cmd} not found on PATH`, fix };
}

function notInitialized(name: string): CheckResult {
  return { name, status: 'fail', detail: 'workspace not initialized', fix: INIT_FIX };
}

function embeddingModelCheck(): CheckResult {
  const cacheDir = resolveModelCacheDir(process.env);
  return modelIsCached(cacheDir)
    ? { name: 'Embedding model', status: 'ok', detail: cacheDir }
    : { name: 'Embedding model', status: 'warn', detail: 'not downloaded; runs on first index' };
}

function usearchCheck(): CheckResult {
  try {
    new USearchVectorIndex({ dimensions: 384, file: null });
    return { name: 'USearch', status: 'ok', detail: 'native binary loaded' };
  } catch (error) {
    return {
      name: 'USearch',
      status: 'fail',
      detail: (error as Error).message,
      fix: 'reinstall yandecode; native binary failed to load',
    };
  }
}

function repositoryIndexCheck(stateDbFile: string, indexesDir: string): CheckResult {
  if (!existsSync(stateDbFile))
    return { name: 'Repository index', status: 'skip', detail: 'no database' };
  const db = openDatabase(stateDbFile);
  try {
    const meta = db
      .prepare('SELECT generation, vector_count, file_path FROM vector_index_meta WHERE name = ?')
      .get('repository') as
      { generation: number; vector_count: number; file_path: string } | undefined;
    if (!meta)
      return { name: 'Repository index', status: 'warn', detail: 'not built; run yandecode index' };
    const chunks = (db.prepare('SELECT COUNT(*) AS c FROM chunks').get() as { c: number }).c;
    const onDisk = existsSync(indexesDir) ? listGenerations(indexesDir, 'repository') : [];
    const maxOnDisk = onDisk.length > 0 ? Math.max(...onDisk) : null;
    const outOfSync =
      !existsSync(meta.file_path) ||
      meta.vector_count !== chunks ||
      (maxOnDisk !== null && maxOnDisk !== meta.generation);
    if (outOfSync) {
      return {
        name: 'Repository index',
        status: 'fail',
        detail: `VECTOR INDEX OUT OF SYNC\nMetadata generation: ${meta.generation}\nVector generation: ${maxOnDisk ?? 'missing'}`,
        fix: 'yandecode index --rebuild-vectors',
      };
    }
    return {
      name: 'Repository index',
      status: 'ok',
      detail: `${chunks} chunks, generation ${meta.generation}`,
    };
  } finally {
    db.close();
  }
}

export function runDoctor(deps: DoctorDeps): CheckResult[] {
  const results: CheckResult[] = [];
  const major = Number.parseInt(deps.nodeVersion.replace(/^v/, '').split('.')[0] ?? '0', 10);
  results.push(
    major >= 22
      ? { name: 'Node.js', status: 'ok', detail: deps.nodeVersion }
      : {
          name: 'Node.js',
          status: 'fail',
          detail: `${deps.nodeVersion} (need >= 22)`,
          fix: 'install Node.js 22 or newer',
        },
  );
  results.push(toolCheck('npm', 'npm', deps.probeVersion, 'install npm (ships with Node.js)'));
  results.push(
    toolCheck(
      'Claude Code',
      'claude',
      deps.probeVersion,
      'install Claude Code: https://code.claude.com/docs/en/setup',
    ),
  );
  results.push(toolCheck('Git', 'git', deps.probeVersion, 'install git'));
  results.push({ name: 'YandeCode', status: 'ok', detail: deps.yandecodeVersion });

  const paths = resolveWorkspace(deps.cwd);
  const projectChecks = [
    'Config',
    'Managed files',
    'Hooks',
    'MCP',
    'CLAUDE.md',
    'SQLite',
    'WAL',
    'Schema',
    'FTS5',
  ];
  if (!paths) {
    for (const name of projectChecks) results.push(notInitialized(name));
    results.push(embeddingModelCheck());
    results.push(usearchCheck());
    results.push({ name: 'Repository index', status: 'skip', detail: 'workspace not initialized' });
    return results;
  }

  try {
    loadConfig(paths.root);
    results.push({ name: 'Config', status: 'ok', detail: paths.configFile });
  } catch (error) {
    results.push({
      name: 'Config',
      status: 'fail',
      detail: (error as Error).message,
      fix: 'fix yandecode.json or delete it and run yandecode init',
    });
  }

  const manifest = readManifest(paths.managedManifest);
  if (!manifest) {
    results.push({
      name: 'Managed files',
      status: 'fail',
      detail: 'managed.json missing',
      fix: INIT_FIX,
    });
  } else {
    const missing: string[] = [];
    const edited: string[] = [];
    for (const f of manifest.files) {
      const abs = resolveInsideRoot(paths.root, f.path);
      if (!existsSync(abs)) missing.push(f.path);
      else if (sha256(readFileSync(abs)) !== f.hash) edited.push(f.path);
    }
    if (missing.length > 0)
      results.push({
        name: 'Managed files',
        status: 'fail',
        detail: `missing: ${missing.join(', ')}`,
        fix: INIT_FIX,
      });
    else if (edited.length > 0)
      results.push({
        name: 'Managed files',
        status: 'warn',
        detail: `edited locally: ${edited.join(', ')}`,
      });
    else
      results.push({
        name: 'Managed files',
        status: 'ok',
        detail: `${manifest.files.length} files (v${manifest.version})`,
      });
  }

  const settingsFile = join(paths.root, '.claude', 'settings.json');
  if (isMalformedJson(settingsFile)) {
    results.push({
      name: 'Hooks',
      status: 'fail',
      detail: `malformed JSON: ${settingsFile}`,
      fix: 'fix the JSON syntax in .claude/settings.json or delete it and run yandecode init',
    });
  } else {
    const settings = readJsonSafe<{ hooks?: Record<string, unknown[]> }>(settingsFile, {});
    const hookText = JSON.stringify(settings.hooks ?? {});
    const missingHooks = HOOK_EVENTS.filter((e) => !hookText.includes(`yandecode hook ${e}`));
    results.push(
      missingHooks.length === 0
        ? { name: 'Hooks', status: 'ok', detail: HOOK_EVENTS.join(', ') }
        : {
            name: 'Hooks',
            status: 'fail',
            detail: `missing: ${missingHooks.join(', ')}`,
            fix: INIT_FIX,
          },
    );
  }

  const mcpFile = join(paths.root, '.mcp.json');
  if (isMalformedJson(mcpFile)) {
    results.push({
      name: 'MCP',
      status: 'fail',
      detail: `malformed JSON: ${mcpFile}`,
      fix: 'fix the JSON syntax in .mcp.json or delete it and run yandecode init',
    });
  } else {
    const mcp = readJsonSafe<{ mcpServers?: Record<string, unknown> }>(mcpFile, {});
    results.push(
      mcp.mcpServers?.yandecode
        ? { name: 'MCP', status: 'ok', detail: 'yandecode server registered in .mcp.json' }
        : {
            name: 'MCP',
            status: 'fail',
            detail: 'yandecode server missing from .mcp.json',
            fix: INIT_FIX,
          },
    );
  }

  const claudeMd = join(paths.root, 'CLAUDE.md');
  results.push(
    existsSync(claudeMd) && readFileSync(claudeMd, 'utf8').includes(CLAUDE_MD_START)
      ? { name: 'CLAUDE.md', status: 'ok', detail: 'yandecode block present' }
      : { name: 'CLAUDE.md', status: 'fail', detail: 'yandecode block missing', fix: INIT_FIX },
  );

  if (!existsSync(paths.stateDb)) {
    results.push({ name: 'SQLite', status: 'fail', detail: 'state.db missing', fix: INIT_FIX });
    results.push({ name: 'WAL', status: 'skip', detail: 'no database' });
    results.push({ name: 'Schema', status: 'skip', detail: 'no database' });
    results.push({ name: 'FTS5', status: 'skip', detail: 'no database' });
  } else {
    try {
      const db = openDatabase(paths.stateDb);
      results.push({ name: 'SQLite', status: 'ok', detail: paths.stateDb });
      const mode = db.pragma('journal_mode', { simple: true }) as string;
      results.push(
        mode === 'wal'
          ? { name: 'WAL', status: 'ok', detail: 'journal_mode=wal' }
          : { name: 'WAL', status: 'warn', detail: `journal_mode=${mode}` },
      );
      const v = schemaVersion(db);
      results.push(
        v === SCHEMA_VERSION
          ? { name: 'Schema', status: 'ok', detail: `version ${v}` }
          : {
              name: 'Schema',
              status: 'fail',
              detail: `version ${v}, expected ${SCHEMA_VERSION}`,
              fix: INIT_FIX,
            },
      );
      results.push({ name: 'FTS5', status: 'ok', detail: 'available' });
      db.close();
    } catch (error) {
      results.push({
        name: 'SQLite',
        status: 'fail',
        detail: (error as Error).message,
        fix: 'delete .yandecode/state.db and run yandecode init',
      });
      results.push({ name: 'WAL', status: 'skip', detail: 'database unavailable' });
      results.push({ name: 'Schema', status: 'skip', detail: 'database unavailable' });
      results.push({ name: 'FTS5', status: 'skip', detail: 'database unavailable' });
    }
  }

  results.push(embeddingModelCheck());
  results.push(usearchCheck());
  results.push(repositoryIndexCheck(paths.stateDb, paths.indexesDir));
  return results;
}

export function formatDoctor(results: CheckResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${r.name.padEnd(20)} ${r.status.toUpperCase().padEnd(7)} ${r.detail}`);
    if (r.fix) lines.push(`  Fix: ${r.fix}`);
  }
  return `${lines.join('\n')}\n`;
}

export function doctorExitCode(results: CheckResult[]): number {
  return results.some((r) => r.status === 'fail') ? 1 : 0;
}
