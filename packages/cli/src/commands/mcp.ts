import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerCommand } from '../cli.js';
import { openRuntime } from '../context.js';
import { createMcpServer } from '../mcp/server.js';
import { createRetrieval } from '../retrieval-runtime.js';
import { createSwarmRuntime } from '../swarm-runtime.js';

registerCommand((program) => {
  const mcp = program.command('mcp').description('MCP server commands');
  mcp
    .command('serve')
    .description('Run the YandeCode MCP server over stdio (used by Claude Code)')
    .action(async () => {
      const rt = openRuntime(process.cwd());
      const AUTO_REINDEX_MAX_DIRTY = 20;
      const search = async (query: string, options: { limit: number }) => {
        const dirty = rt.index.listDirty().length;
        if (dirty >= 1 && dirty <= AUTO_REINDEX_MAX_DIRTY) {
          const pre = createRetrieval(rt);
          try {
            await pre.indexing.run({ mode: 'incremental' });
          } finally {
            await pre.dispose();
          }
        }
        // Re-created below so the loaded vector index reflects any reindex that just ran.
        const retrieval = createRetrieval(rt);
        try {
          return await retrieval.retriever.search(query, options);
        } finally {
          await retrieval.dispose();
        }
      };
      const note = (): string | null => {
        const dirty = rt.index.listDirty().length;
        return dirty > AUTO_REINDEX_MAX_DIRTY ? `NOTE: ${dirty} files changed since the last index; run "yandecode index".` : null;
      };
      const swarmRt = createSwarmRuntime(rt);
      const server = createMcpServer({
        rt,
        search,
        note,
        swarmService: swarmRt.swarmService,
        messages: swarmRt.messages,
        memoryService: swarmRt.memoryService,
        memoryRetriever: swarmRt.memoryRetriever,
      });
      const transport = new StdioServerTransport();
      await rt.events.emit({ event: 'mcp_started' });
      const shutdown = async (): Promise<void> => {
        await rt.events.emit({ event: 'mcp_stopped' });
        await server.close();
        rt.close();
      };
      process.stdin.on('close', () => void shutdown());
      process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
      process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));
      await server.connect(transport);
    });
});
