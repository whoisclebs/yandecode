import { spawn, spawnSync } from 'node:child_process';
import { resolveClaudeBin } from '../claude-bin.js';
import { registerCommand } from '../cli.js';
import { openRuntime } from '../context.js';
import { defaultProbeVersion, doctorExitCode, formatDoctor, runDoctor } from '../doctor/checks.js';
import { createRetrieval } from '../retrieval-runtime.js';
import { VERSION } from '../version.js';

const DANGEROUS_FLAG = '--dangerously-skip-permissions';

export interface StartResult {
  exitCode: number;
}

export async function runStart(cwd: string, passthrough: string[]): Promise<StartResult> {
  if (passthrough.includes(DANGEROUS_FLAG)) {
    process.stderr.write(
      `refusing to pass ${DANGEROUS_FLAG}: YandeCode relies on Claude Code's normal permission prompts\n`,
    );
    return { exitCode: 1 };
  }

  const doctorResults = runDoctor({
    cwd,
    probeVersion: defaultProbeVersion,
    nodeVersion: process.version,
    yandecodeVersion: VERSION,
  });
  if (doctorExitCode(doctorResults) !== 0) {
    process.stdout.write(formatDoctor(doctorResults));
    return { exitCode: 1 };
  }

  const rt = openRuntime(cwd);
  try {
    const retrieval = createRetrieval(rt);
    try {
      await retrieval.indexing.run({
        mode: 'incremental',
        onProgress: (p) => {
          process.stdout.write(`\r${p.phase.padEnd(8)} ${p.done}/${p.total}${' '.repeat(20)}`);
        },
      });
      process.stdout.write('\n');
    } finally {
      await retrieval.dispose();
    }

    const claudeBin = resolveClaudeBin();
    const probe = spawnSync(claudeBin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (probe.status !== 0) {
      process.stderr.write(
        `"${claudeBin} --version" failed; install Claude Code: https://code.claude.com/docs/en/setup\n`,
      );
      return { exitCode: 1 };
    }

    await rt.events.emit({ event: 'start_launched', data: { args: passthrough } });
    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(claudeBin, ['--agent', 'yandecode-dispatcher', ...passthrough], {
        stdio: 'inherit',
        cwd: rt.paths.root,
      });
      child.on('exit', (code) => resolve(code ?? 1));
      child.on('error', (err) => {
        process.stderr.write(`failed to launch "${claudeBin}": ${err.message}\n`);
        resolve(1);
      });
    });
    await rt.events.emit({ event: 'start_exited', data: { exitCode } });
    return { exitCode };
  } finally {
    rt.close();
  }
}

registerCommand((program) => {
  program
    .command('start')
    .description('Index the repository and launch Claude Code with the YandeCode dispatcher agent')
    .argument('[claudeArgs...]', 'arguments passed through to claude after --')
    .action(async (claudeArgs: string[]) => {
      const result = await runStart(process.cwd(), claudeArgs);
      process.exitCode = result.exitCode;
    });
});
