import { DocumentRepository } from '@yandecode/core';
import {
  ArcticEmbedXsProvider,
  createDefaultChunker,
  HashEmbeddingProvider,
  HybridRetriever,
  IndexingService,
  resolveModelCacheDir,
  USearchVectorIndex,
  type EmbeddingProvider,
} from '@yandecode/retrieval';
import type { RuntimeContext } from './context.js';

export interface Retrieval {
  provider: EmbeddingProvider;
  documents: DocumentRepository;
  indexing: IndexingService;
  retriever: HybridRetriever;
  dispose(): Promise<void>;
}

export function createProvider(rt: RuntimeContext): EmbeddingProvider {
  if (process.env.YANDECODE_EMBEDDINGS === 'hash') return new HashEmbeddingProvider(64);
  return new ArcticEmbedXsProvider({
    cacheDir: resolveModelCacheDir(process.env),
    modelId: rt.config.rag.embeddingModel,
  });
}

/**
 * `sharedProvider`, when passed, is reused instead of constructing a new one, and `dispose()`
 * becomes a no-op for it - the caller owns its lifecycle. This lets a long-running process (the
 * MCP server) hold one persistent EmbeddingProvider across many `createRetrieval` calls instead
 * of tearing down and reconstructing the ONNX pipeline on every request, while everything else
 * (documents/chunker/index/retriever) still gets rebuilt fresh each call so index freshness after
 * a reindex is unaffected.
 */
export function createRetrieval(rt: RuntimeContext, sharedProvider?: EmbeddingProvider): Retrieval {
  const provider = sharedProvider ?? createProvider(rt);
  const documents = new DocumentRepository(rt.state);
  const chunker = createDefaultChunker(provider);
  const openIndex = (file: string | null): USearchVectorIndex =>
    new USearchVectorIndex({ dimensions: provider.dimensions, file });

  const indexing = new IndexingService({
    root: rt.paths.root,
    indexesDir: rt.paths.indexesDir,
    documents,
    indexRepo: rt.index,
    provider,
    chunker,
    events: rt.events,
    openIndex,
  });

  const meta = rt.index.getMeta('repository');
  const index = openIndex(meta?.filePath ?? null);
  if (meta?.filePath) index.load();
  const retriever = new HybridRetriever({ documents, provider, index });

  return {
    provider,
    documents,
    indexing,
    retriever,
    dispose: () => (sharedProvider ? Promise.resolve() : provider.dispose()),
  };
}
