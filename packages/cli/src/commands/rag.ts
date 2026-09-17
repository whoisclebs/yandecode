import { registerCommand } from '../cli.js';
import { openRuntime } from '../context.js';
import { formatRagResults } from '../rag/format.js';
import { createRetrieval } from '../retrieval-runtime.js';

registerCommand((program) => {
  const rag = program.command('rag').description('RAG search commands');
  rag
    .command('search <query>')
    .description('Hybrid search over the local RAG index')
    .option('--limit <n>', 'max results', (v) => Number.parseInt(v, 10))
    .option('--json', 'print raw JSON instead of formatted text')
    .action(async (query: string, options: { limit?: number; json?: boolean }) => {
      const rt = openRuntime(process.cwd());
      const retrieval = createRetrieval(rt);
      try {
        const hits = await retrieval.retriever.search(query, { limit: options.limit ?? rt.config.rag.maxResults });
        process.stdout.write(options.json ? `${JSON.stringify(hits, null, 2)}\n` : formatRagResults(query, hits));
      } finally {
        await retrieval.dispose();
        rt.close();
      }
    });
});
