export { buildProgram, main, registerCommand } from './cli.js';
export { openRuntime, tryOpenRuntime, type RuntimeContext } from './context.js';
export { VERSION } from './version.js';
export { createMcpServer, formatHits, type McpDeps, type RagHit, type RagSearchFn } from './mcp/server.js';
