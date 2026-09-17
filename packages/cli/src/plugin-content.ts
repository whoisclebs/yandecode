import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { YandeCodeError } from '@yandecode/core';
import { pluginRoot } from '@yandecode/plugin';

export const AGENT_NAMES = [
  'yandecode-dispatcher',
  'yandecode-scout',
  'yandecode-implementer',
  'yandecode-tester',
  'yandecode-reviewer',
  'yandecode-security',
  'yandecode-researcher',
] as const;

export const SKILL_NAMES = ['yandecode-context-rules', 'yandecode-delegation'] as const;

export const HOOK_EVENTS = ['SessionStart', 'PostToolUse', 'SessionEnd', 'SubagentStop', 'WorktreeCreate', 'WorktreeRemove'] as const;

export interface PluginContent {
  root: string;
  agents: { name: string; file: string }[];
  skills: { name: string; dir: string; file: string }[];
  hooksFile: string;
  mcpFile: string;
  manifestFile: string;
}

export function loadPluginContent(root: string = pluginRoot): PluginContent {
  const content: PluginContent = {
    root,
    agents: AGENT_NAMES.map((name) => ({ name, file: join(root, 'agents', `${name}.md`) })),
    skills: SKILL_NAMES.map((name) => ({
      name,
      dir: join(root, 'skills', name),
      file: join(root, 'skills', name, 'SKILL.md'),
    })),
    hooksFile: join(root, 'hooks', 'hooks.json'),
    mcpFile: join(root, '.mcp.json'),
    manifestFile: join(root, '.claude-plugin', 'plugin.json'),
  };
  const required = [
    ...content.agents.map((a) => a.file),
    ...content.skills.map((s) => s.file),
    content.hooksFile,
    content.mcpFile,
    content.manifestFile,
  ];
  const missing = required.filter((f) => !existsSync(f));
  if (missing.length > 0) {
    throw new YandeCodeError(
      'PLUGIN_CONTENT_MISSING',
      `missing plugin files: ${missing.join(', ')}`,
    );
  }
  return content;
}

export function parseFrontmatter(markdown: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}
