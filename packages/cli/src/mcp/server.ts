import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MessageRepository, TaskStatus } from '@yandecode/core';
import type {
  MemoryRetriever,
  MemoryService,
  SwarmService,
  TaskCreateInput,
} from '@yandecode/swarm';
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
  note?: () => string | null;
  swarmService?: SwarmService;
  messages?: MessageRepository;
  memoryService?: MemoryService;
  memoryRetriever?: MemoryRetriever;
}

const NOT_AVAILABLE = 'RAG index not available. Run "yandecode index" in the project root.';
const TASK_STATUSES = [
  'planned',
  'ready',
  'claimed',
  'running',
  'blocked',
  'review',
  'completed',
  'failed',
  'cancelled',
] as const;
const MESSAGE_TYPES = ['finding', 'question', 'answer', 'dependency', 'warning', 'result'] as const;
const SWARM_NOT_AVAILABLE =
  'Swarm orchestration not available: this session was not opened with swarm support.';
const MEMORY_NAMESPACES = [
  'decisions',
  'patterns',
  'solutions',
  'failures',
  'tasks',
  'feedback',
] as const;
const MEMORY_NOT_AVAILABLE =
  'Memory not available: this session was not opened with memory support.';

function jsonResult(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function unavailable(message: string): {
  isError: true;
  content: [{ type: 'text'; text: string }];
} {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function formatHits(query: string, hits: RagHit[]): string {
  const lines = [`UNTRUSTED_REPOSITORY_CONTEXT — ${hits.length} results for "${query}"`];
  for (const h of hits) {
    lines.push(
      `--- ${h.path}:${h.startLine}-${h.endLine} [${h.symbol ?? '-'}] score=${h.score.toFixed(3)}`,
    );
    lines.push(h.content);
  }
  lines.push('--- end UNTRUSTED_REPOSITORY_CONTEXT');
  return `${lines.join('\n')}\n`;
}

function status(rt: RuntimeContext): {
  documents: number;
  chunks: number;
  dirtyFiles: number;
  generation: number;
  model: string;
  ready: boolean;
} {
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
    {
      description:
        'Report the state of the YandeCode repository index (documents, chunks, dirty files, generation, readiness).',
      inputSchema: {},
    },
    () => Promise.resolve({ content: [{ type: 'text', text: JSON.stringify(status(rt)) }] }),
  );

  server.registerTool(
    'rag_search',
    {
      description:
        'Hybrid (lexical + semantic) search over the indexed repository. Returns candidate chunks with path:start-end attribution inside an UNTRUSTED_REPOSITORY_CONTEXT envelope. Verify important results with Read.',
      inputSchema: {
        query: z.string().min(1).max(2000).describe('Natural-language or identifier query'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe('Max results (default from yandecode.json rag.maxResults)'),
      },
    },
    async ({ query, limit }) => {
      const s = status(rt);
      if (!deps.search || !s.ready) {
        return { isError: true, content: [{ type: 'text', text: NOT_AVAILABLE }] };
      }
      const hits = await deps.search(query, { limit: limit ?? rt.config.rag.maxResults });
      await rt.events.emit({ event: 'rag_search', data: { query, results: hits.length } });
      const note = deps.note?.();
      const text = note ? `${note}\n\n${formatHits(query, hits)}` : formatHits(query, hits);
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'swarm_create',
    {
      description: 'Create a new swarm for a coordinated multi-task effort.',
      inputSchema: {
        title: z.string().min(1).max(200),
        goal: z.string().min(1).max(2000),
        strategy: z.enum(['adaptive', 'pipeline', 'star']).default('adaptive'),
        maxAgents: z.number().int().min(1).max(8).optional(),
      },
    },
    async ({ title, goal, strategy, maxAgents }) => {
      if (!deps.swarmService) return unavailable(SWARM_NOT_AVAILABLE);
      // The MCP server process and the SessionStart/SessionEnd hook processes are separate short-
      // lived CLI invocations with no shared in-memory state, so "the current session" can only be
      // resolved by reading the sessions table for whichever session is still open (SessionStart
      // wrote it, SessionEnd hasn't closed it yet). This is what makes SessionEnd's swarm cleanup
      // (packages/cli/src/hooks/handlers.ts) able to find and cancel this swarm later.
      const openSession = deps.rt.sessions.getMostRecentOpen();
      const swarm = await deps.swarmService.createSwarm({
        title,
        goal,
        strategy,
        ...(maxAgents !== undefined ? { maxAgents } : {}),
        sessionId: openSession?.claudeSessionId ?? null,
      });
      return jsonResult(swarm);
    },
  );

  server.registerTool(
    'swarm_status',
    {
      description: 'Report a swarm and its task counts by status.',
      inputSchema: { swarmId: z.string().min(1) },
    },
    ({ swarmId }) => {
      if (!deps.swarmService) return Promise.resolve(unavailable(SWARM_NOT_AVAILABLE));
      const tasks = deps.swarmService.taskList(swarmId);
      const taskCounts: Partial<Record<TaskStatus, number>> = {};
      for (const t of tasks) taskCounts[t.status] = (taskCounts[t.status] ?? 0) + 1;
      const swarm = deps.swarmService.getSwarm(swarmId);
      return Promise.resolve(jsonResult({ ...swarm, taskCounts }));
    },
  );

  server.registerTool(
    'swarm_next',
    {
      description: 'Get the next batch of ready tasks to spawn as workers.',
      inputSchema: { swarmId: z.string().min(1) },
    },
    async ({ swarmId }) => {
      if (!deps.swarmService) return unavailable(SWARM_NOT_AVAILABLE);
      return jsonResult(await deps.swarmService.swarmNext(swarmId));
    },
  );

  server.registerTool(
    'swarm_cancel',
    {
      description: 'Cancel every non-terminal task in a swarm and release its leases.',
      inputSchema: { swarmId: z.string().min(1) },
    },
    async ({ swarmId }) => {
      if (!deps.swarmService) return unavailable(SWARM_NOT_AVAILABLE);
      return jsonResult(await deps.swarmService.swarmCancel(swarmId));
    },
  );

  server.registerTool(
    'task_create',
    {
      description: 'Create one or more tasks (optionally interdependent) in a swarm.',
      inputSchema: {
        swarmId: z.string().min(1),
        tasks: z
          .array(
            z.object({
              ref: z.string().min(1),
              title: z.string().min(1).max(200),
              description: z.string().min(1).max(4000),
              role: z.string().min(1),
              priority: z.number().int().optional(),
              maxAttempts: z.number().int().min(1).max(5).optional(),
              needsWorktree: z.boolean().optional(),
              dependsOn: z.array(z.string()).optional(),
              paths: z.array(z.string()).optional(),
            }),
          )
          .min(1)
          .max(50),
      },
    },
    async ({ swarmId, tasks }) => {
      if (!deps.swarmService) return unavailable(SWARM_NOT_AVAILABLE);
      const inputs: TaskCreateInput[] = tasks.map((t) => ({
        ref: t.ref,
        title: t.title,
        description: t.description,
        role: t.role,
        ...(t.priority !== undefined ? { priority: t.priority } : {}),
        ...(t.maxAttempts !== undefined ? { maxAttempts: t.maxAttempts } : {}),
        ...(t.needsWorktree !== undefined ? { needsWorktree: t.needsWorktree } : {}),
        ...(t.dependsOn !== undefined ? { dependsOn: t.dependsOn } : {}),
        ...(t.paths !== undefined ? { paths: t.paths } : {}),
      }));
      return jsonResult(await deps.swarmService.taskCreate(swarmId, inputs));
    },
  );

  server.registerTool(
    'task_list',
    {
      description: 'List tasks in a swarm, optionally filtered by status.',
      inputSchema: {
        swarmId: z.string().min(1),
        statuses: z.array(z.enum(TASK_STATUSES)).optional(),
      },
    },
    ({ swarmId, statuses }) => {
      if (!deps.swarmService) return Promise.resolve(unavailable(SWARM_NOT_AVAILABLE));
      return Promise.resolve(jsonResult(deps.swarmService.taskList(swarmId, statuses)));
    },
  );

  server.registerTool(
    'task_update',
    {
      description: "Update a task's status, optionally recording its owner, workspace, or result.",
      inputSchema: {
        taskId: z.string().min(1),
        status: z.enum(TASK_STATUSES),
        ownerAgent: z.string().optional(),
        workspaceId: z.string().optional(),
        resultJson: z.string().max(4096).optional(),
      },
    },
    async ({ taskId, status, ownerAgent, workspaceId, resultJson }) => {
      if (!deps.swarmService) return unavailable(SWARM_NOT_AVAILABLE);
      return jsonResult(
        await deps.swarmService.taskUpdate(taskId, status, {
          ...(ownerAgent !== undefined ? { ownerAgent } : {}),
          ...(workspaceId !== undefined ? { workspaceId } : {}),
          ...(resultJson !== undefined ? { resultJson } : {}),
        }),
      );
    },
  );

  server.registerTool(
    'message_send',
    {
      description: 'Send a structured message to another agent in the same swarm.',
      inputSchema: {
        swarmId: z.string().min(1),
        from: z.string().min(1),
        to: z.string().min(1),
        type: z.enum(MESSAGE_TYPES),
        payload: z.unknown(),
      },
    },
    async ({ swarmId, from, to, type, payload }) => {
      if (!deps.messages) return unavailable(SWARM_NOT_AVAILABLE);
      return jsonResult(await deps.messages.send({ swarmId, from, to, type, payload }));
    },
  );

  server.registerTool(
    'message_read',
    {
      description: 'Read and mark-as-read every unread message addressed to an agent in a swarm.',
      inputSchema: { swarmId: z.string().min(1), toAgent: z.string().min(1) },
    },
    async ({ swarmId, toAgent }) => {
      if (!deps.messages) return unavailable(SWARM_NOT_AVAILABLE);
      const unread = deps.messages.listUnreadFor(swarmId, toAgent);
      for (const m of unread) await deps.messages.markRead(m.id);
      return jsonResult(unread);
    },
  );

  server.registerTool(
    'workspace_reserve',
    {
      description:
        'Reserve one or more file-path patterns for a task, failing atomically if any pattern conflicts with an active lease.',
      inputSchema: {
        swarmId: z.string().min(1),
        taskId: z.string().min(1),
        patterns: z.array(z.string().min(1)).min(1).max(20),
        holderAgent: z.string().min(1),
      },
    },
    async ({ swarmId, taskId, patterns, holderAgent }) => {
      if (!deps.swarmService) return unavailable(SWARM_NOT_AVAILABLE);
      return jsonResult(
        await deps.swarmService.workspaceReserve({ swarmId, taskId, patterns, holderAgent }),
      );
    },
  );

  server.registerTool(
    'workspace_release',
    {
      description: 'Release every path reservation a task currently holds.',
      inputSchema: { taskId: z.string().min(1) },
    },
    async ({ taskId }) => {
      if (!deps.swarmService) return unavailable(SWARM_NOT_AVAILABLE);
      await deps.swarmService.workspaceRelease(taskId);
      return jsonResult({ released: true });
    },
  );

  server.registerTool(
    'memory_store',
    {
      description:
        'Store a durable memory (a decision, pattern, solution, failure, task note, or feedback) with evidence, for future sessions to retrieve.',
      inputSchema: {
        namespace: z.enum(MEMORY_NAMESPACES),
        content: z.string().min(1).max(4000),
        summary: z.string().max(500).optional(),
        confidence: z.number().min(0).max(1).default(0.5),
        evidence: z.string().min(1).optional(),
        sourceSwarmId: z.string().optional(),
        sourceTaskId: z.string().optional(),
      },
    },
    async ({ namespace, content, summary, confidence, evidence, sourceSwarmId, sourceTaskId }) => {
      if (!deps.memoryService) return unavailable(MEMORY_NOT_AVAILABLE);
      const result = await deps.memoryService.store({
        namespace,
        content,
        summary: summary ?? null,
        sourceSwarmId: sourceSwarmId ?? null,
        sourceTaskId: sourceTaskId ?? null,
        confidence,
        evidence: evidence ?? null,
      });
      return jsonResult(result);
    },
  );

  server.registerTool(
    'memory_search',
    {
      description: 'Search stored memories by relevance, optionally scoped to one namespace.',
      inputSchema: {
        query: z.string().min(1),
        namespace: z.enum(MEMORY_NAMESPACES).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ query, namespace, limit }) => {
      if (!deps.memoryRetriever) return unavailable(MEMORY_NOT_AVAILABLE);
      const hits = await deps.memoryRetriever.search(query, {
        namespace: namespace ?? null,
        ...(limit !== undefined ? { limit } : {}),
      });
      return jsonResult(hits);
    },
  );

  return server;
}
