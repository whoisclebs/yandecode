import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AGENT_NAMES,
  HOOK_EVENTS,
  SKILL_NAMES,
  loadPluginContent,
  parseFrontmatter,
} from '../src/plugin-content.js';

describe('plugin content', () => {
  const content = loadPluginContent();

  it('ships exactly seven agents whose frontmatter name matches the filename', () => {
    expect(content.agents.map((a) => a.name)).toEqual([...AGENT_NAMES]);
    for (const agent of content.agents) {
      const fm = parseFrontmatter(readFileSync(agent.file, 'utf8'));
      expect(fm.name).toBe(agent.name);
      expect(fm.description?.length ?? 0).toBeGreaterThan(20);
      expect(fm.model).toBe('inherit');
      expect(fm.mcpServers).toBe('yandecode');
    }
  });

  it('gives read-only agents no write tools', () => {
    for (const name of [
      'yandecode-scout',
      'yandecode-reviewer',
      'yandecode-security',
      'yandecode-researcher',
    ]) {
      const agent = content.agents.find((a) => a.name === name);
      const fm = parseFrontmatter(readFileSync(agent!.file, 'utf8'));
      expect(fm.tools).toBeDefined();
      expect(fm.tools).not.toMatch(/\b(Write|Edit|MultiEdit|NotebookEdit)\b/);
    }
  });

  it('never references swarm or memory MCP tools in v0', () => {
    for (const file of [
      ...content.agents.map((a) => a.file),
      ...content.skills.map((s) => s.file),
    ]) {
      expect(readFileSync(file, 'utf8')).not.toMatch(
        /\b(swarm_|task_create|task_update|message_send|memory_store|memory_search|workspace_reserve)\b/,
      );
    }
  });

  it('ships two skills with descriptions', () => {
    expect(content.skills.map((s) => s.name)).toEqual([...SKILL_NAMES]);
    for (const skill of content.skills) {
      const fm = parseFrontmatter(readFileSync(skill.file, 'utf8'));
      expect(fm.name).toBe(skill.name);
      expect(fm.description?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('declares hooks that call yandecode hook <event> with a 10 s timeout', () => {
    const hooks = JSON.parse(readFileSync(content.hooksFile, 'utf8')) as {
      hooks: Record<
        string,
        { matcher?: string; hooks: { type: string; command: string; timeout: number }[] }[]
      >;
    };
    expect(Object.keys(hooks.hooks)).toEqual([...HOOK_EVENTS]);
    for (const [event, groups] of Object.entries(hooks.hooks)) {
      for (const group of groups) {
        for (const h of group.hooks) {
          expect(h.type).toBe('command');
          expect(h.command).toBe(`yandecode hook ${event}`);
          expect(h.timeout).toBe(10);
        }
      }
    }
    expect(hooks.hooks.PostToolUse?.[0]?.matcher).toBe('Write|Edit|MultiEdit|NotebookEdit');
  });

  it('declares the yandecode MCP server over stdio', () => {
    const mcp = JSON.parse(readFileSync(content.mcpFile, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(mcp.mcpServers.yandecode).toEqual({ command: 'yandecode', args: ['mcp', 'serve'] });
  });

  it('has a valid plugin manifest', () => {
    const manifest = JSON.parse(readFileSync(content.manifestFile, 'utf8')) as {
      name: string;
      version: string;
    };
    expect(manifest.name).toBe('yandecode');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('parseFrontmatter handles missing and present blocks', () => {
    expect(parseFrontmatter('no frontmatter')).toEqual({});
    expect(parseFrontmatter('---\nname: x\ndescription: a: b\n---\nbody')).toEqual({
      name: 'x',
      description: 'a: b',
    });
  });
});
