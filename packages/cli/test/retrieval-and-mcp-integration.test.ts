import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRuntime } from '../src/context.js';
import { createMcpServer } from '../src/mcp/server.js';
import { createRetrieval } from '../src/retrieval-runtime.js';

const text = (r: unknown): string =>
  (r as { content: { type: string; text: string }[] }).content[0]!.text;

let previousFlag: string | undefined;

beforeEach(() => {
  previousFlag = process.env.YANDECODE_EMBEDDINGS;
  process.env.YANDECODE_EMBEDDINGS = 'hash';
});

afterEach(() => {
  if (previousFlag === undefined) delete process.env.YANDECODE_EMBEDDINGS;
  else process.env.YANDECODE_EMBEDDINGS = previousFlag;
});

describe('rag_search end-to-end with the hash embedding test double', () => {
  it('indexes a small repository and returns a matching chunk over MCP', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yc-e2e-'));
    writeFileSync(join(dir, 'yandecode.json'), '{}');
    writeFileSync(
      join(dir, 'auth.ts'),
      'export function login(user: string): boolean {\n  return checkPassword(user);\n}\n',
    );
    const rt = openRuntime(dir);
    const retrieval = createRetrieval(rt);
    await retrieval.indexing.run({ mode: 'incremental' });
    await retrieval.dispose();

    const search = async (query: string, options: { limit: number }) => {
      const r = createRetrieval(rt);
      try {
        return await r.retriever.search(query, options);
      } finally {
        await r.dispose();
      }
    };
    const server = createMcpServer({ rt, search });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);

    const r = await client.callTool({
      name: 'rag_search',
      arguments: { query: 'login password check', limit: 5 },
    });
    expect(text(r)).toContain('auth.ts');

    await client.close();
    rt.close();
  });
});
