import { Command } from 'commander';
import { VERSION } from './version.js';

export type CommandRegistrar = (program: Command) => void;

const registrars: CommandRegistrar[] = [];

export function registerCommand(registrar: CommandRegistrar): void {
  registrars.push(registrar);
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('yandecode')
    .description('YandeCode — local-first agent harness for Claude Code')
    .version(VERSION, '-v, --version')
    .showHelpAfterError();
  for (const register of registrars) register(program);
  return program;
}

export async function main(argv: string[]): Promise<void> {
  await buildProgram().parseAsync(argv);
}
