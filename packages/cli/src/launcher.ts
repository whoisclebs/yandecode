import { spawnSync } from 'node:child_process';

export interface Launcher {
  command: string;
  args: string[];
}

export function defaultProbe(command: string): boolean {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    timeout: 5000,
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

export function resolveLauncher(probe: (cmd: string) => boolean = defaultProbe): Launcher {
  return probe('yandecode') ? { command: 'yandecode', args: [] } : { command: 'npx', args: ['yandecode'] };
}

export function launcherCommandLine(launcher: Launcher, ...rest: string[]): string {
  return [launcher.command, ...launcher.args, ...rest].join(' ');
}
