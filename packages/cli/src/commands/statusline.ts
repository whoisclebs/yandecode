import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { SwarmRepository, TaskRepository } from '@yandecode/core';
import { registerCommand } from '../cli.js';
import { tryOpenRuntime } from '../context.js';
import { HOOK_EVENTS } from '../plugin-content.js';
import { gatherGitInfo } from '../status-line/git.js';
import { renderStatusLine, type StatusLineInput } from '../status-line/render.js';
import { VERSION } from '../version.js';

interface ClaudeStatusPayload {
  model?: { display_name?: string };
  workspace?: { current_dir?: string; project_dir?: string };
  cost?: { total_duration_ms?: number };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

function parsePayload(raw: string): ClaudeStatusPayload {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ClaudeStatusPayload;
  } catch {
    return {};
  }
}

function indexBytesOf(dir: string): number {
  try {
    return readdirSync(dir).reduce((sum, name) => sum + statSync(join(dir, name)).size, 0);
  } catch {
    return 0;
  }
}

function buildWorkspaceInfo(cwd: string): {
  workspace: StatusLineInput['workspace'];
  root: string | null;
} {
  const rt = tryOpenRuntime(cwd);
  if (!rt) return { workspace: null, root: null };
  try {
    const counts = rt.index.counts();
    const dirtyFiles = rt.index.listDirty().length;
    const meta = rt.index.getMeta('repository');
    const activeSwarm = new SwarmRepository(rt.state).getMostRecentActive();
    const swarm = activeSwarm
      ? (() => {
          const tasks = new TaskRepository(rt.state).listBySwarm(activeSwarm.id);
          return {
            done: tasks.filter((t) => t.status === 'completed').length,
            total: tasks.length,
          };
        })()
      : null;
    return {
      root: rt.paths.root,
      workspace: {
        chunks: counts.chunks,
        dirtyFiles,
        indexGeneration: meta?.generation ?? 0,
        indexBytes: indexBytesOf(rt.paths.indexesDir),
        hooksRegistered: HOOK_EVENTS.length,
        hooksTotal: HOOK_EVENTS.length,
        swarm,
      },
    };
  } finally {
    rt.close();
  }
}

registerCommand((program) => {
  program
    .command('statusline')
    .description(
      'Render a Claude Code status line with YandeCode swarm/RAG/git info (reads JSON from stdin)',
    )
    .action(async () => {
      const payload = parsePayload(await readStdin());
      const cwd = payload.workspace?.current_dir ?? payload.workspace?.project_dir ?? process.cwd();
      const { workspace, root } = buildWorkspaceInfo(cwd);
      const line = renderStatusLine({
        version: VERSION,
        projectName: basename(root ?? cwd),
        model: payload.model?.display_name ?? null,
        durationMs: payload.cost?.total_duration_ms ?? null,
        git: gatherGitInfo(cwd),
        workspace,
      });
      process.stdout.write(`${line}\n`);
    });
});
