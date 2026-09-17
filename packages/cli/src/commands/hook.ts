import { registerCommand } from '../cli.js';
import { runHookCommand } from '../hooks/handlers.js';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

registerCommand((program) => {
  program
    .command('hook <event>')
    .description('Claude Code hook entry point (reads the hook JSON from stdin)')
    .action(async (event: string) => {
      const stdinText = await readStdin();
      const result = await runHookCommand(event, stdinText, process.cwd());
      if (result.stdout) process.stdout.write(result.stdout);
      process.exitCode = result.exitCode;
    });
});
