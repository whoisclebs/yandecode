import { registerCommand } from '../cli.js';
import { runInit } from '../integration/init.js';

registerCommand((program) => {
  program
    .command('init')
    .description('Set up YandeCode in the current project (idempotent, non-destructive)')
    .option('--force', 'overwrite managed files even if you edited them', false)
    .action(async (opts: { force: boolean }) => {
      const report = await runInit(process.cwd(), { force: opts.force });
      const counts = report.files.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.action]: (acc[f.action] ?? 0) + 1 }), {});
      process.stdout.write(`YandeCode initialized in ${report.root}\n`);
      process.stdout.write(`  managed files: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}\n`);
      for (const f of report.files.filter((x) => x.action === 'preserved')) {
        process.stdout.write(`  preserved (edited by you, use --force to overwrite): ${f.path}\n`);
      }
      process.stdout.write(`  config: ${report.configCreated ? 'created yandecode.json' : 'kept yandecode.json'}\n`);
      process.stdout.write('Next: yandecode doctor, then yandecode index, then yandecode start\n');
    });
});
