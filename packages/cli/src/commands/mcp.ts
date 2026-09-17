import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerCommand } from '../cli.js';
import { openRuntime } from '../context.js';
import { createMcpServer } from '../mcp/server.js';

registerCommand((program) => {
  const mcp = program.command('mcp').description('MCP server commands');
  mcp
    .command('serve')
    .description('Run the YandeCode MCP server over stdio (used by Claude Code)')
    .action(async () => {
      const rt = openRuntime(process.cwd());
      const server = createMcpServer({ rt });
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
