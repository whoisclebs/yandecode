import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  LeaseRepository,
  MemoryRepository,
  MessageRepository,
  SwarmRepository,
  TaskRepository,
  WorkspaceRepository,
  nowIso,
} from '@yandecode/core';
import {
  ArcticEmbedXsProvider,
  generationFileName,
  HashEmbeddingProvider,
  resolveModelCacheDir,
  USearchVectorIndex,
  type EmbeddingProvider,
} from '@yandecode/retrieval';
import { MemoryRetriever, MemoryService, SwarmService } from '@yandecode/swarm';
import type { RuntimeContext } from './context.js';

export interface SwarmRuntime {
  swarmService: SwarmService;
  messages: MessageRepository;
  memoryService: MemoryService;
  memoryRetriever: MemoryRetriever;
}

function createMemoryProvider(): EmbeddingProvider {
  if (process.env.YANDECODE_EMBEDDINGS === 'hash') return new HashEmbeddingProvider(64);
  return new ArcticEmbedXsProvider({ cacheDir: resolveModelCacheDir(process.env) });
}

export async function createSwarmRuntime(rt: RuntimeContext): Promise<SwarmRuntime> {
  const swarmService = new SwarmService({
    swarms: new SwarmRepository(rt.state),
    tasks: new TaskRepository(rt.state),
    leases: new LeaseRepository(rt.state),
    workspaces: new WorkspaceRepository(rt.state),
  });

  mkdirSync(rt.paths.indexesDir, { recursive: true });
  const provider = createMemoryProvider();
  const memories = new MemoryRepository(rt.state);
  const meta = rt.index.getMeta('memory');
  const file = meta?.filePath ?? join(rt.paths.indexesDir, generationFileName('memory', 1));
  const index = new USearchVectorIndex({ dimensions: provider.dimensions, file });
  if (meta?.filePath) {
    index.load();
  } else {
    // Awaited (not fire-and-forget): StateService.write() queues this write and only attaches
    // its rejection handler to a *derived* promise, so a void-ed call here would both risk an
    // unhandled rejection and let a short-lived CLI process (e.g. a single hook invocation)
    // exit before the write actually lands, silently dropping the very first 'memory' index
    // meta row.
    await rt.index.setMeta({
      name: 'memory',
      generation: 1,
      dimensions: provider.dimensions,
      modelId: provider.modelId,
      vectorCount: 0,
      builtAt: nowIso(),
      filePath: file,
    });
  }

  // Defends against a missing, corrupt, or stale-empty on-disk index: if what actually loaded
  // doesn't match the memories table (the real source of truth for embeddings, per ADR-007), the
  // next memory_store's index.save() would otherwise atomically overwrite the good on-disk file
  // with an incomplete one. Rebuilding from iterateEmbeddings() is the same recovery IndexingService
  // already provides for the repository index's 'rebuild-vectors' mode.
  if (index.stats().size !== memories.count()) {
    index.rebuild(
      (function* rebuildRecords() {
        for (const { vectorId, embedding } of memories.iterateEmbeddings()) {
          yield { id: vectorId, vector: embedding };
        }
      })(),
    );
  }

  const memoryService = new MemoryService({ memories, provider, index });
  const memoryRetriever = new MemoryRetriever({ memories, provider, index });

  return {
    swarmService,
    messages: new MessageRepository(rt.state),
    memoryService,
    memoryRetriever,
  };
}
