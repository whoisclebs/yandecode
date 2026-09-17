#!/usr/bin/env node
import './commands/index.js';
import { main } from './cli.js';

main(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`yandecode: ${message}\n`);
  process.exitCode = 1;
});
