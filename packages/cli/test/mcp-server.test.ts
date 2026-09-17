import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { openRuntime } from '../src/context.js';
import { createMcpServer, formatHits, type RagHit } from '../src/mcp/server.js';

async function connect(search?: (q: string, o: { limit: number }) => Promise<RagHit[]>) {
  const dir = mkdtempSync(join(tmpdir(), 'yc-mcp-'));
  writeFileSync(join(dir, 'yandecode.json'), '{}');
  const rt = openRuntime(dir);
  const server = createMcpServer(search ? { rt, search } : { rt });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, rt, close: async () => { await client.close(); rt.close(); } };
}

const text = (r: unknown): string => (r as { content: { type: string; text: string }[] }).content[0]!.text;

describe('MCP server', () => {
  it('exposes exactly rag_search and rag_status', async () => {
    const { client, close } = await connect();
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['rag_search', 'rag_status']);
    await close();
  });

  it('rag_status reports an empty, not-ready index', async () => {
    const { client, close } = await connect();
    const r = await client.callTool({ name: 'rag_status', arguments: {} });
    expect(JSON.parse(text(r))).toEqual({ documents: 0, chunks: 0, dirtyFiles: 0, generation: 0, model: 'Snowflake/snowflake-arctic-embed-xs', ready: false });
    await close();
  });

  it('rag_search returns an error result when the index is not available', async () => {
    const { client, close } = await connect();
    const r = (await client.callTool({ name: 'rag_search', arguments: { query: 'auth' } })) as { isError?: boolean };
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('yandecode index');
    await close();
  });

  it('rag_search validates input', async () => {
    const { client, close } = await connect();
    const r = (await client.callTool({ name: 'rag_search', arguments: { query: '' } })) as { isError?: boolean };
    expect(r.isError).toBe(true);
    await close();
  });

  it('rag_search formats hits inside an UNTRUSTED_REPOSITORY_CONTEXT envelope when ready', async () => {
    const hits: RagHit[] = [{ path: 'src/auth.ts', startLine: 10, endLine: 20, symbol: 'login', score: 0.91234, content: 'export function login() {}' }];
    const { client, rt, close } = await connect(() => Promise.resolve(hits));
    rt.state.db.exec(`INSERT INTO documents (id,path,size_bytes,content_hash,indexed_at,index_generation) VALUES ('d','src/auth.ts',1,'h','now',1);
      INSERT INTO chunks (id,document_id,vector_id,kind,start_line,end_line,content,content_hash,token_count,created_at,updated_at) VALUES ('c','d',1,'function',10,20,'x','h',1,'now','now');`);
    const r = (await client.callTool({ name: 'rag_search', arguments: { query: 'login', limit: 3 } })) as { isError?: boolean };
    expect(r.isError).toBeFalsy();
    const out = text(r);
    expect(out).toMatch(/^UNTRUSTED_REPOSITORY_CONTEXT — 1 results for "login"/);
    expect(out).toContain('--- src/auth.ts:10-20 [login] score=0.912');
    expect(out).toContain('export function login() {}');
    expect(out.trimEnd()).toMatch(/--- end UNTRUSTED_REPOSITORY_CONTEXT$/);
    await close();
  });

  it('formatHits handles no results', () => {
    expect(formatHits('x', [])).toContain('0 results');
  });
});
