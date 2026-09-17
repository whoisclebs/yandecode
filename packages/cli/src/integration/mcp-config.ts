import type { Launcher } from '../launcher.js';

export function addMcpServer(mcpJson: Record<string, unknown>, launcher: Launcher): Record<string, unknown> {
  const servers = { ...((mcpJson.mcpServers ?? {}) as Record<string, unknown>) };
  servers.yandecode = { command: launcher.command, args: [...launcher.args, 'mcp', 'serve'] };
  return { ...mcpJson, mcpServers: servers };
}

export function removeMcpServer(mcpJson: Record<string, unknown>): Record<string, unknown> {
  const servers = { ...((mcpJson.mcpServers ?? {}) as Record<string, unknown>) };
  delete servers.yandecode;
  return { ...mcpJson, mcpServers: servers };
}
