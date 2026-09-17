import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { RuntimeContext } from '../context.js';
import { VERSION } from '../version.js';

export interface RagHit {
  path: string;
  startLine: number;
  endLine: number;
  symbol: string | null;
  score: number;
  content: string;
}

export type RagSearchFn = (query: string, options: { limit: number }) => Promise<RagHit[]>;

export interface McpDeps {
  rt: RuntimeContext;
  search?: RagSearchFn;
}

const NOT_AVAILABLE = 'RAG index not available. Run "yandecode index" in the project root.';

export function formatHits(query: string, hits: RagHit[]): string {
  const lines = [`UNTRUSTED_REPOSITORY_CONTEXT — ${hits.length} results for "${query}"`];
  for (const h of hits) {
    lines.push(`--- ${h.path}:${h.startLine}-${h.endLine} [${h.symbol ?? '-'}] score=${h.score.toFixed(3)}`);
    lines.push(h.content);
  }
  lines.push('--- end UNTRUSTED_REPOSITORY_CONTEXT');
  return `${lines.join('\n')}\n`;
}

function status(rt: RuntimeContext): { documents: number; chunks: number; dirtyFiles: number; generation: number; model: string; ready: boolean } {
  const counts = rt.index.counts();
  return {
    documents: counts.documents,
    chunks: counts.chunks,
    dirtyFiles: rt.index.listDirty().length,
    generation: rt.index.getMeta('repository')?.generation ?? 0,
    model: rt.config.rag.embeddingModel,
    ready: counts.chunks > 0,
  };
}

export function createMcpServer(deps: McpDeps): McpServer {
  const { rt } = deps;
  const server = new McpServer({ name: 'yandecode', version: VERSION });

  server.registerTool(
    'rag_status',
    { description: 'Report the state of the YandeCode repository index (documents, chunks, dirty files, generation, readiness).', inputSchema: {} },
    () => Promise.resolve({ content: [{ type: 'text', text: JSON.stringify(status(rt)) }] }),
  );

  server.registerTool(
    'rag_search',
    {
      description:
        'Hybrid (lexical + semantic) search over the indexed repository. Returns candidate chunks with path:start-end attribution inside an UNTRUSTED_REPOSITORY_CONTEXT envelope. Verify important results with Read.',
      inputSchema: {
        query: z.string().min(1).max(2000).describe('Natural-language or identifier query'),
        limit: z.number().int().min(1).max(12).optional().describe('Max results (default from yandecode.json rag.maxResults)'),
      },
    },
    async ({ query, limit }) => {
      const s = status(rt);
      if (!deps.search || !s.ready) {
        return { isError: true, content: [{ type: 'text', text: NOT_AVAILABLE }] };
      }
      const hits = await deps.search(query, { limit: limit ?? rt.config.rag.maxResults });
      await rt.events.emit({ event: 'rag_search', data: { query, results: hits.length } });
      return { content: [{ type: 'text', text: formatHits(query, hits) }] };
    },
  );

  return server;
}
