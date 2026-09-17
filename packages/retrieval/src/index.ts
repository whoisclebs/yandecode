export { ApproxTokenCounter, type EmbeddingProvider, type TokenCounter } from './embeddings/provider.js';
export { HashEmbeddingProvider } from './embeddings/hash-provider.js';
export {
  ARCTIC_DIMENSIONS,
  ARCTIC_MODEL_ID,
  ArcticEmbedXsProvider,
  QUERY_PREFIX,
  modelIsCached,
  resolveModelCacheDir,
  type ArcticOptions,
} from './embeddings/arctic.js';
export { DEFAULT_LIMITS, type Chunk, type ChunkLimits, type Chunker } from './chunking/types.js';
export { LineChunker } from './chunking/line-chunker.js';
export { MarkdownChunker } from './chunking/markdown-chunker.js';
export { GRAMMAR_FILES, detectLanguage } from './chunking/languages.js';
export { identifiersOf } from './lexical/identifiers.js';
export { TreeSitterChunker } from './chunking/tree-sitter-chunker.js';
export { ChunkerRouter, createDefaultChunker } from './chunking/router.js';
export { buildIgnore, DEFAULT_IGNORED_DIRS, isProbablyBinary, MAX_FILE_BYTES, SECRET_PATTERNS } from './scanner/rules.js';
export { diffScan, scanRepository, type DiffResult, type ExistingDoc, type ScannedFile } from './scanner/scanner.js';
export { generationFileName, listGenerations, removeOtherGenerations } from './vector/generations.js';
export type { VectorHit, VectorIndex, VectorIndexStats, VectorRecord } from './vector/types.js';
export { USearchVectorIndex, type USearchVectorIndexOptions } from './vector/usearch-index.js';
export {
  IndexingService,
  type IndexingServiceDeps,
  type IndexMode,
  type IndexProgress,
  type IndexReport,
  type IndexRunOptions,
  type IndexStatus,
} from './service/indexing-service.js';
