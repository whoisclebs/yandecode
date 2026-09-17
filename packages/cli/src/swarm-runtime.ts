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

export function createSwarmRuntime(rt: RuntimeContext): SwarmRuntime {
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
    void rt.index.setMeta({
      name: 'memory',
      generation: 1,
      dimensions: provider.dimensions,
      modelId: provider.modelId,
      vectorCount: 0,
      builtAt: nowIso(),
      filePath: file,
    });
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
