import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { LeaseRepository, MemoryRepository, MessageRepository, SwarmRepository, TaskRepository, WorkspaceRepository, type MemoryRecord } from '@yandecode/core';
import { HashEmbeddingProvider, USearchVectorIndex } from '@yandecode/retrieval';
import { MemoryRetriever, MemoryService, SwarmService } from '@yandecode/swarm';
import { openRuntime } from '../src/context.js';
import { createMcpServer, formatHits, type RagHit } from '../src/mcp/server.js';

async function connect(
  search?: (q: string, o: { limit: number }) => Promise<RagHit[]>,
  note?: () => string | null,
  withSwarm = false,
) {
  const dir = mkdtempSync(join(tmpdir(), 'yc-mcp-'));
  writeFileSync(join(dir, 'yandecode.json'), '{}');
  const rt = openRuntime(dir);
  const extra = withSwarm
    ? (() => {
        const memories = new MemoryRepository(rt.state);
        const memoryProvider = new HashEmbeddingProvider(64);
        const memoryIndex = new USearchVectorIndex({ dimensions: 64, file: join(dir, 'memory-test.usearch') });
        return {
          swarmService: new SwarmService({
            swarms: new SwarmRepository(rt.state),
            tasks: new TaskRepository(rt.state),
            leases: new LeaseRepository(rt.state),
            workspaces: new WorkspaceRepository(rt.state),
          }),
          messages: new MessageRepository(rt.state),
          memoryService: new MemoryService({ memories, provider: memoryProvider, index: memoryIndex }),
          memoryRetriever: new MemoryRetriever({ memories, provider: memoryProvider, index: memoryIndex }),
        };
      })()
    : {};
  const server = createMcpServer({ rt, ...(search ? { search } : {}), ...(note ? { note } : {}), ...extra });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    rt,
    close: async () => {
      await client.close();
      rt.close();
    },
  };
}

const text = (r: unknown): string =>
  (r as { content: { type: string; text: string }[] }).content[0]!.text;

describe('MCP server', () => {
  it('exposes rag_search and rag_status (plus swarm/task/message/workspace/memory tools, always registered)', async () => {
    const { client, close } = await connect();
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toContain('rag_search');
    expect(tools).toContain('rag_status');
    expect(tools).toHaveLength(15);
    await close();
  });

  it('rag_status reports an empty, not-ready index', async () => {
    const { client, close } = await connect();
    const r = await client.callTool({ name: 'rag_status', arguments: {} });
    expect(JSON.parse(text(r))).toEqual({
      documents: 0,
      chunks: 0,
      dirtyFiles: 0,
      generation: 0,
      model: 'Snowflake/snowflake-arctic-embed-xs',
      ready: false,
    });
    await close();
  });

  it('rag_search returns an error result when the index is not available', async () => {
    const { client, close } = await connect();
    const r = (await client.callTool({ name: 'rag_search', arguments: { query: 'auth' } })) as {
      isError?: boolean;
    };
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('yandecode index');
    await close();
  });

  it('rag_search validates input', async () => {
    const { client, close } = await connect();
    const r = (await client.callTool({ name: 'rag_search', arguments: { query: '' } })) as {
      isError?: boolean;
    };
    expect(r.isError).toBe(true);
    await close();
  });

  it('rag_search formats hits inside an UNTRUSTED_REPOSITORY_CONTEXT envelope when ready', async () => {
    const hits: RagHit[] = [
      {
        path: 'src/auth.ts',
        startLine: 10,
        endLine: 20,
        symbol: 'login',
        score: 0.91234,
        content: 'export function login() {}',
      },
    ];
    const { client, rt, close } = await connect(() => Promise.resolve(hits));
    rt.state.db
      .exec(`INSERT INTO documents (id,path,size_bytes,content_hash,indexed_at,index_generation) VALUES ('d','src/auth.ts',1,'h','now',1);
      INSERT INTO chunks (id,document_id,vector_id,kind,start_line,end_line,content,content_hash,token_count,created_at,updated_at) VALUES ('c','d',1,'function',10,20,'x','h',1,'now','now');`);
    const r = (await client.callTool({
      name: 'rag_search',
      arguments: { query: 'login', limit: 3 },
    })) as { isError?: boolean };
    expect(r.isError).toBeFalsy();
    const out = text(r);
    expect(out).toMatch(/^UNTRUSTED_REPOSITORY_CONTEXT — 1 results for "login"/);
    expect(out).toContain('--- src/auth.ts:10-20 [login] score=0.912');
    expect(out).toContain('export function login() {}');
    expect(out.trimEnd()).toMatch(/--- end UNTRUSTED_REPOSITORY_CONTEXT$/);
    await close();
  });

  it('prepends a note before the envelope when one is provided', async () => {
    const { client, rt, close } = await connect(() => Promise.resolve([]), () => 'NOTE: 42 files changed since the last index; run "yandecode index".');
    rt.state.db.exec(`INSERT INTO documents (id,path,size_bytes,content_hash,indexed_at,index_generation) VALUES ('d','a.ts',1,'h','now',1);
      INSERT INTO chunks (id,document_id,vector_id,kind,start_line,end_line,content,content_hash,token_count,created_at,updated_at) VALUES ('c','d',1,'function',1,1,'x','h',1,'now','now');`);
    const r = await client.callTool({ name: 'rag_search', arguments: { query: 'x' } });
    expect(text(r)).toMatch(/^NOTE: 42 files changed since the last index; run "yandecode index"\.\n\nUNTRUSTED_REPOSITORY_CONTEXT/);
    await close();
  });

  it('formatHits handles no results', () => {
    expect(formatHits('x', [])).toContain('0 results');
  });
});

describe('swarm/task/message/workspace/memory MCP tools', () => {
  it('exposes all 15 v0 tools once swarm and memory deps are wired', async () => {
    const { client, close } = await connect(undefined, undefined, true);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(
      [
        'memory_search',
        'memory_store',
        'message_read',
        'message_send',
        'rag_search',
        'rag_status',
        'swarm_cancel',
        'swarm_create',
        'swarm_next',
        'swarm_status',
        'task_create',
        'task_list',
        'task_update',
        'workspace_release',
        'workspace_reserve',
      ].sort(),
    );
    await close();
  });

  it('returns isError when swarm deps are not wired', async () => {
    const { client, close } = await connect();
    const r = (await client.callTool({ name: 'swarm_create', arguments: { title: 't', goal: 'g' } })) as { isError?: boolean };
    expect(r.isError).toBe(true);
    await close();
  });

  it('drives the full happy path: create swarm, create tasks, swarm_next, task_update, message send/read, workspace reserve/release', async () => {
    const { client, close } = await connect(undefined, undefined, true);

    const created = (await client.callTool({ name: 'swarm_create', arguments: { title: 'Add auth', goal: 'Implement login' } })) as { content: { text: string }[] };
    const swarm = JSON.parse(created.content[0]!.text) as { id: string };

    const tasksResult = (await client.callTool({
      name: 'task_create',
      arguments: { swarmId: swarm.id, tasks: [{ ref: 'a', title: 'Implement', description: 'd', role: 'implementer', paths: ['src/auth/**'] }] },
    })) as { content: { text: string }[] };
    const [task] = JSON.parse(tasksResult.content[0]!.text) as { id: string; status: string }[];
    expect(task!.status).toBe('planned');

    await client.callTool({ name: 'task_update', arguments: { taskId: task!.id, status: 'ready' } });
    const nextResult = (await client.callTool({ name: 'swarm_next', arguments: { swarmId: swarm.id } })) as { content: { text: string }[] };
    const spawnRequests = JSON.parse(nextResult.content[0]!.text) as { taskId: string }[];
    expect(spawnRequests.map((r) => r.taskId)).toEqual([task!.id]);

    const sendResult = (await client.callTool({
      name: 'message_send',
      arguments: { swarmId: swarm.id, from: task!.id, to: 'dispatcher', type: 'finding', payload: { summary: 'x', evidence: [] } },
    })) as { content: { text: string }[] };
    expect(JSON.parse(sendResult.content[0]!.text)).toMatchObject({ type: 'finding' });

    const readResult = (await client.callTool({ name: 'message_read', arguments: { swarmId: swarm.id, toAgent: 'dispatcher' } })) as { content: { text: string }[] };
    expect(JSON.parse(readResult.content[0]!.text)).toHaveLength(1);
    const readAgain = (await client.callTool({ name: 'message_read', arguments: { swarmId: swarm.id, toAgent: 'dispatcher' } })) as { content: { text: string }[] };
    expect(JSON.parse(readAgain.content[0]!.text)).toHaveLength(0);

    const reserveResult = (await client.callTool({
      name: 'workspace_reserve',
      arguments: { swarmId: swarm.id, taskId: task!.id, patterns: ['docs/**'], holderAgent: task!.id },
    })) as { content: { text: string }[] };
    expect(JSON.parse(reserveResult.content[0]!.text)).toMatchObject({ granted: true });

    const releaseResult = (await client.callTool({ name: 'workspace_release', arguments: { taskId: task!.id } })) as { isError?: boolean };
    expect(releaseResult.isError).toBeFalsy();

    const cancelResult = (await client.callTool({ name: 'swarm_cancel', arguments: { swarmId: swarm.id } })) as { content: { text: string }[] };
    expect(JSON.parse(cancelResult.content[0]!.text)).toMatchObject({ cancelledTaskIds: [task!.id] });

    await close();
  });

  it('task_list filters by status and swarm_status reports task counts', async () => {
    const { client, close } = await connect(undefined, undefined, true);
    const created = (await client.callTool({ name: 'swarm_create', arguments: { title: 't', goal: 'g' } })) as { content: { text: string }[] };
    const swarm = JSON.parse(created.content[0]!.text) as { id: string };
    await client.callTool({ name: 'task_create', arguments: { swarmId: swarm.id, tasks: [{ ref: 'a', title: 'a', description: 'd', role: 'implementer' }] } });

    const all = (await client.callTool({ name: 'task_list', arguments: { swarmId: swarm.id } })) as { content: { text: string }[] };
    expect(JSON.parse(all.content[0]!.text)).toHaveLength(1);

    const readyOnly = (await client.callTool({ name: 'task_list', arguments: { swarmId: swarm.id, statuses: ['ready'] } })) as { content: { text: string }[] };
    expect(JSON.parse(readyOnly.content[0]!.text)).toHaveLength(0);

    const status = (await client.callTool({ name: 'swarm_status', arguments: { swarmId: swarm.id } })) as { content: { text: string }[] };
    expect(JSON.parse(status.content[0]!.text)).toMatchObject({ id: swarm.id, taskCounts: { planned: 1 } });
    await close();
  });

  it('stores and retrieves a memory end to end through the MCP tools', async () => {
    const { client, close } = await connect(undefined, undefined, true);

    const rejected = (await client.callTool({ name: 'memory_store', arguments: { namespace: 'patterns', content: 'no evidence here' } })) as { content: { text: string }[] };
    expect(JSON.parse(rejected.content[0]!.text)).toMatchObject({ status: 'rejected' });

    const stored = (await client.callTool({
      name: 'memory_store',
      arguments: { namespace: 'patterns', content: 'retry idle connections with exponential backoff', evidence: 'task-1', confidence: 0.7 },
    })) as { content: { text: string }[] };
    const parsedStored = JSON.parse(stored.content[0]!.text) as { status: string; memory?: MemoryRecord };
    expect(parsedStored.status).toBe('stored');

    const searched = (await client.callTool({ name: 'memory_search', arguments: { query: 'retry idle connections with exponential backoff', namespace: 'patterns' } })) as { content: { text: string }[] };
    const hits = JSON.parse(searched.content[0]!.text) as { id: string }[];
    expect(hits.map((h) => h.id)).toContain(parsedStored.memory!.id);

    await close();
  });

  it('returns isError when memory deps are not wired', async () => {
    const { client, close } = await connect();
    const r = (await client.callTool({ name: 'memory_search', arguments: { query: 'x' } })) as { isError?: boolean };
    expect(r.isError).toBe(true);
    await close();
  });
});
