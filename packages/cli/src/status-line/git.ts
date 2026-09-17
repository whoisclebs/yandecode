import { execFileSync } from 'node:child_process';
import type { StatusLineGitInfo } from './render.js';

function run(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString('utf8')
      .trim();
  } catch {
    return null;
  }
}

export function gatherGitInfo(cwd: string): StatusLineGitInfo | null {
  const branch = run(['branch', '--show-current'], cwd);
  if (branch === null) return null;

  const statusOut = run(['status', '--porcelain'], cwd) ?? '';
  const dirty = statusOut.length > 0;

  let ahead = 0;
  let behind = 0;
  const counts = run(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], cwd);
  if (counts) {
    const parts = counts.split(/\s+/);
    const a = Number.parseInt(parts[0] ?? '', 10);
    const b = Number.parseInt(parts[1] ?? '', 10);
    ahead = Number.isFinite(a) ? a : 0;
    behind = Number.isFinite(b) ? b : 0;
  }

  return { branch: branch || '(detached)', dirty, ahead, behind };
}
