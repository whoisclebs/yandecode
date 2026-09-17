import type { IndexMode, IndexStatus } from '@yandecode/retrieval';
import { registerCommand } from '../cli.js';
import { openRuntime } from '../context.js';
import { createRetrieval } from '../retrieval-runtime.js';

function printStatus(status: IndexStatus): void {
  process.stdout.write(
    `documents ${status.documents}, chunks ${status.chunks}, dirty ${status.dirtyFiles}, generation ${status.generation}, vectors ${status.vectorCount}, inSync ${status.inSync}\n`,
  );
}

registerCommand((program) => {
  program
    .command('index')
    .description('Build or update the local RAG index for this repository')
    .option('--full', 'reprocess every file from scratch, bumping the index generation')
    .option(
      '--rebuild-vectors',
      'rebuild the vector index from stored embeddings without re-embedding',
    )
    .option('--status', 'print index status and exit without indexing')
    .action(async (options: { full?: boolean; rebuildVectors?: boolean; status?: boolean }) => {
      const rt = openRuntime(process.cwd());
      const retrieval = createRetrieval(rt);
      try {
        if (options.status) {
          printStatus(retrieval.indexing.status());
          return;
        }
        const mode: IndexMode = options.rebuildVectors
          ? 'rebuild-vectors'
          : options.full
            ? 'full'
            : 'incremental';
        const report = await retrieval.indexing.run({
          mode,
          onProgress: (p) => {
            process.stdout.write(
              `\r${p.phase.padEnd(8)} ${p.done}/${p.total}${p.path ? ` ${p.path}` : ''}${' '.repeat(20)}`,
            );
          },
        });
        process.stdout.write('\n');
        process.stdout.write(
          `added ${report.added}, changed ${report.changed}, removed ${report.removed}, unchanged ${report.unchanged}, chunks ${report.chunks}, generation ${report.generation}, ${report.durationMs}ms\n`,
        );
        const status = retrieval.indexing.status();
        if (!status.inSync) {
          process.stderr.write(
            'index is out of sync after the run; try "yandecode index --rebuild-vectors"\n',
          );
          process.exitCode = 1;
        }
      } finally {
        await retrieval.dispose();
        rt.close();
      }
    });
});
