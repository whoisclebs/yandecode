import { SCHEMA_VERSION } from '@yandecode/core';
import { registerCommand } from '../cli.js';
import { openRuntime } from '../context.js';

registerCommand((program) => {
  program
    .command('status')
    .description('Show workspace, index and recent activity')
    .action(() => {
      const rt = openRuntime(process.cwd());
      try {
        const counts = rt.index.counts();
        const dirty = rt.index.listDirty().length;
        const meta = rt.index.getMeta('repository');
        process.stdout.write(`Workspace            ${rt.paths.root}\n`);
        process.stdout.write(`Config               rag=${rt.config.rag.enabled ? 'on' : 'off'} maxResults=${rt.config.rag.maxResults} model=${rt.config.rag.embeddingModel}\n`);
        process.stdout.write(`Schema               version ${SCHEMA_VERSION}\n`);
        process.stdout.write(`Repository index     ${counts.documents} documents, ${counts.chunks} chunks, generation ${meta?.generation ?? 0}\n`);
        process.stdout.write(`Dirty files          ${dirty}\n`);
        const recent = rt.state.read((db) => db.prepare('SELECT ts, event FROM events ORDER BY ts DESC LIMIT 5').all()) as { ts: string; event: string }[];
        process.stdout.write('Recent events\n');
        for (const e of recent) process.stdout.write(`  ${e.ts}  ${e.event}\n`);
      } finally {
        rt.close();
      }
    });
});
