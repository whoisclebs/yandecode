import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/integration/init.js';
import { runStart } from '../src/commands/start.js';

let previousBin: string | undefined;
let previousEmbeddings: string | undefined;

beforeEach(() => {
  previousBin = process.env.YANDECODE_CLAUDE_BIN;
  previousEmbeddings = process.env.YANDECODE_EMBEDDINGS;
});

afterEach(() => {
  if (previousBin === undefined) delete process.env.YANDECODE_CLAUDE_BIN;
  else process.env.YANDECODE_CLAUDE_BIN = previousBin;
  if (previousEmbeddings === undefined) delete process.env.YANDECODE_EMBEDDINGS;
  else process.env.YANDECODE_EMBEDDINGS = previousEmbeddings;
});

function writeFakeClaude(logFile: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'yc-fake-claude-'));
  const script = join(dir, 'fake-claude.cjs');
  writeFileSync(
    script,
    `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + '\\n');\nconsole.log('2.0.0 (fake claude)');\nprocess.exit(0);\n`,
  );
  chmodSync(script, 0o755);
  return script;
}

describe('runStart', () => {
  it('refuses --dangerously-skip-permissions without touching doctor or indexing', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'yc-start-danger-'));
    const result = await runStart(cwd, ['--dangerously-skip-permissions']);
    expect(result.exitCode).toBe(1);
  });

  it('aborts with exit code 1 when doctor reports a failure', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'yc-start-nodoctor-'));
    const result = await runStart(cwd, []);
    expect(result.exitCode).toBe(1);
  });

  it('probes the version, indexes, and launches claude with the dispatcher agent and passthrough args', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'yc-start-ok-'));
    await runInit(cwd, { launcher: { command: 'yandecode', args: [] } });
    const logFile = join(cwd, 'fake-claude.log');
    process.env.YANDECODE_CLAUDE_BIN = writeFakeClaude(logFile);
    process.env.YANDECODE_EMBEDDINGS = 'hash';

    const result = await runStart(cwd, ['--resume']);
    expect(result.exitCode).toBe(0);

    const calls = readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { argv: string[]; cwd: string });
    // Call 0 is doctor's own "Claude Code" health check (now probing the
    // configured YANDECODE_CLAUDE_BIN, not a hardcoded 'claude' - see the
    // resolveClaudeBin() fix); call 1 is runStart's pre-launch version probe.
    expect(calls[0]?.argv).toEqual(['--version']);
    expect(calls[1]?.argv).toEqual(['--version']);
    expect(calls[2]?.argv).toEqual(['--agent', 'yandecode-dispatcher', '--resume']);
    expect(calls[2]?.cwd).toBe(cwd);
  });

  it('exits cleanly with code 1 instead of crashing when the claude binary cannot be found at all', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'yc-start-noclaudebin-'));
    await runInit(cwd, { launcher: { command: 'yandecode', args: [] } });
    process.env.YANDECODE_CLAUDE_BIN = '/definitely/does/not/exist/claude';
    process.env.YANDECODE_EMBEDDINGS = 'hash';

    await expect(runStart(cwd, [])).resolves.toEqual({ exitCode: 1 });
  });
});
