import { registerCommand } from '../cli.js';
import { runUninstall } from '../integration/uninstall.js';

registerCommand((program) => {
  program
    .command('uninstall')
    .description('Remove everything YandeCode added to this project')
    .option('--purge', 'also delete .yandecode/ (state.db, indexes, logs)', false)
    .action(async (opts: { purge: boolean }) => {
      const report = await runUninstall(process.cwd(), { purge: opts.purge });
      process.stdout.write(`removed ${report.removed.length} managed files\n`);
      for (const s of report.skipped) process.stdout.write(`  kept (edited by you): ${s}\n`);
      process.stdout.write(
        report.purged ? 'deleted .yandecode/\n' : 'kept .yandecode/ (use --purge to delete)\n',
      );
    });
});
