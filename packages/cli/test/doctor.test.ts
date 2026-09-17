import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { doctorExitCode, formatDoctor, runDoctor } from '../src/doctor/checks.js';
import { openRuntime } from '../src/context.js';
import { runInit } from '../src/integration/init.js';

const probeAllOk = (cmd: string): string | null =>
  ({ npm: '10.9.8', claude: '2.1.273 (Claude Code)', git: 'git version 2.47.3' })[cmd] ?? null;

const byName = (results: ReturnType<typeof runDoctor>, name: string) =>
  results.find((r) => r.name === name)!;

describe('runDoctor', () => {
  it('fails project checks with an init hint when the workspace is not initialized', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'yc-doc-none-'));
    const results = runDoctor({
      cwd,
      probeVersion: probeAllOk,
      nodeVersion: 'v22.22.3',
      yandecodeVersion: '0.1.0',
    });
    expect(byName(results, 'Node.js').status).toBe('ok');
    expect(byName(results, 'Claude Code').status).toBe('ok');
    expect(byName(results, 'Config').status).toBe('fail');
    expect(byName(results, 'Config').fix).toBe('yandecode init');
    expect(doctorExitCode(results)).toBe(1);
  });

  it('flags old Node and missing Claude Code', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'yc-doc-old-'));
    const results = runDoctor({
      cwd,
      probeVersion: () => null,
      nodeVersion: 'v20.1.0',
      yandecodeVersion: '0.1.0',
    });
    expect(byName(results, 'Node.js').status).toBe('fail');
    expect(byName(results, 'Claude Code').status).toBe('fail');
    expect(byName(results, 'npm').status).toBe('fail');
  });

  it('passes every Part 1 check after init and warns on edited managed files', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'yc-doc-ok-'));
    await runInit(cwd, { launcher: { command: 'yandecode', args: [] } });
    let results = runDoctor({
      cwd,
      probeVersion: probeAllOk,
      nodeVersion: 'v22.22.3',
      yandecodeVersion: '0.1.0',
    });
    for (const name of [
      'Config',
      'Managed files',
      'Hooks',
      'MCP',
      'CLAUDE.md',
      'SQLite',
      'WAL',
      'Schema',
      'FTS5',
    ]) {
      expect(byName(results, name).status, name).toBe('ok');
    }
    expect(byName(results, 'Repository index').status).toBe('warn');
    expect(['ok', 'warn']).toContain(byName(results, 'Embedding model').status);
    expect(byName(results, 'USearch').status).toBe('ok');
    expect(doctorExitCode(results)).toBe(0);
    writeFileSync(join(cwd, '.claude', 'agents', 'yandecode-scout.md'), 'edited');
    results = runDoctor({
      cwd,
      probeVersion: probeAllOk,
      nodeVersion: 'v22.22.3',
      yandecodeVersion: '0.1.0',
    });
    expect(byName(results, 'Managed files').status).toBe('warn');
    expect(byName(results, 'Managed files').detail).toContain('yandecode-scout.md');
  });

  it('reports a failed Hooks check instead of throwing on malformed .claude/settings.json', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'yc-doc-badjson-'));
    await runInit(cwd, { launcher: { command: 'yandecode', args: [] } });
    writeFileSync(join(cwd, '.claude', 'settings.json'), '{ not valid json');
    const results = runDoctor({
      cwd,
      probeVersion: probeAllOk,
      nodeVersion: 'v22.22.3',
      yandecodeVersion: '0.1.0',
    });
    expect(byName(results, 'Hooks').status).toBe('fail');
    expect(byName(results, 'Hooks').detail).toContain('malformed JSON');
    expect(byName(results, 'Hooks').fix).toBeDefined();
    // Every other check still ran; a bad settings.json must not crash doctor.
    expect(byName(results, 'MCP').status).toBe('ok');
  });

  it('reports a failed MCP check instead of throwing on malformed .mcp.json', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'yc-doc-badmcp-'));
    await runInit(cwd, { launcher: { command: 'yandecode', args: [] } });
    writeFileSync(join(cwd, '.mcp.json'), '{ not valid json');
    const results = runDoctor({
      cwd,
      probeVersion: probeAllOk,
      nodeVersion: 'v22.22.3',
      yandecodeVersion: '0.1.0',
    });
    expect(byName(results, 'MCP').status).toBe('fail');
    expect(byName(results, 'MCP').detail).toContain('malformed JSON');
    expect(byName(results, 'MCP').fix).toBeDefined();
    expect(byName(results, 'Hooks').status).toBe('ok');
  });

  it('formats aligned output with fix lines', () => {
    const text = formatDoctor([
      { name: 'Claude Code', status: 'ok', detail: '2.1.273' },
      { name: 'Config', status: 'fail', detail: 'yandecode.json not found', fix: 'yandecode init' },
    ]);
    expect(text).toContain('Claude Code          OK      2.1.273');
    expect(text).toContain('Config               FAIL    yandecode.json not found');
    expect(text).toContain('  Fix: yandecode init');
  });

  it('flags a repository index that is out of sync with its metadata', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'yc-doc-outofsync-'));
    await runInit(cwd, { launcher: { command: 'yandecode', args: [] } });
    const rt = openRuntime(cwd);
    await rt.index.setMeta({ name: 'repository', generation: 3, dimensions: 384, modelId: 'x', vectorCount: 5, builtAt: '2026-01-01T00:00:00.000Z', filePath: join(cwd, 'nowhere.usearch') });
    rt.close();
    const results = runDoctor({ cwd, probeVersion: probeAllOk, nodeVersion: 'v22.22.3', yandecodeVersion: '0.1.0' });
    expect(byName(results, 'Repository index').status).toBe('fail');
    expect(byName(results, 'Repository index').detail).toContain('VECTOR INDEX OUT OF SYNC');
    expect(byName(results, 'Repository index').fix).toBe('yandecode index --rebuild-vectors');
  });
});
