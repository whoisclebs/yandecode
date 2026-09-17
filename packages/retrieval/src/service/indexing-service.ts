import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChunkInput, DocumentRepository, EventLog, IndexName, IndexRepository } from '@yandecode/core';
import type { Chunker } from '../chunking/types.js';
import type { EmbeddingProvider } from '../embeddings/provider.js';
import { identifiersOf } from '../lexical/identifiers.js';
import { diffScan, scanRepository, type ScannedFile } from '../scanner/scanner.js';
import { generationFileName, removeOtherGenerations } from '../vector/generations.js';
import type { VectorIndex } from '../vector/types.js';

const INDEX_NAME: IndexName = 'repository';
const EMBED_BATCH = 32;

export interface IndexingServiceDeps {
  root: string;
  indexesDir: string;
  documents: DocumentRepository;
  indexRepo: IndexRepository;
  provider: EmbeddingProvider;
  chunker: Chunker;
  events: EventLog;
  openIndex: (file: string | null) => VectorIndex;
}

export type IndexMode = 'incremental' | 'full' | 'rebuild-vectors';

export interface IndexProgress {
  phase: 'scan' | 'chunk' | 'embed' | 'vectors' | 'done';
  done: number;
  total: number;
  path?: string;
}

export interface IndexStatus {
  documents: number;
  chunks: number;
  dirtyFiles: number;
  generation: number;
  vectorCount: number;
  vectorFile: string | null;
  inSync: boolean;
}

export interface IndexReport {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  chunks: number;
  generation: number;
  durationMs: number;
}

export interface IndexRunOptions {
  mode: IndexMode;
  onProgress?: (progress: IndexProgress) => void;
}

export class IndexingService {
  constructor(private readonly deps: IndexingServiceDeps) {
    mkdirSync(deps.indexesDir, { recursive: true });
  }

  status(): IndexStatus {
    const meta = this.deps.indexRepo.getMeta(INDEX_NAME);
    const counts = this.deps.documents.counts();
    const vectorFile = meta?.filePath ?? null;
    const inSync = meta !== null && vectorFile !== null && existsSync(vectorFile) && meta.vectorCount === counts.chunks;
    return {
      documents: counts.documents,
      chunks: counts.chunks,
      dirtyFiles: this.deps.indexRepo.listDirty().length,
      generation: meta?.generation ?? 0,
      vectorCount: meta?.vectorCount ?? 0,
      vectorFile,
      inSync,
    };
  }

  async run(options: IndexRunOptions): Promise<IndexReport> {
    const start = Date.now();
    const partial =
      options.mode === 'rebuild-vectors' ? await this.runRebuildVectors(options.onProgress) : await this.runScanBased(options.mode, options.onProgress);
    const report: IndexReport = { ...partial, durationMs: Date.now() - start };
    await this.deps.events.emit({ event: 'index_completed', data: { mode: options.mode, ...report } });
    return report;
  }

  private currentGenerationAndFile(): { generation: number; file: string } {
    const meta = this.deps.indexRepo.getMeta(INDEX_NAME);
    const generation = meta?.generation ?? 1;
    const file = meta?.filePath ?? join(this.deps.indexesDir, generationFileName(INDEX_NAME, generation));
    return { generation, file };
  }

  private async runScanBased(mode: 'incremental' | 'full', onProgress?: (p: IndexProgress) => void): Promise<Omit<IndexReport, 'durationMs'>> {
    if (mode === 'full') {
      for (const doc of this.deps.documents.listDocuments()) await this.deps.documents.deleteDocument(doc.path);
    }

    const scanned = await scanRepository(this.deps.root);
    onProgress?.({ phase: 'scan', done: scanned.length, total: scanned.length });
    const existing = this.deps.documents.listDocuments().map((d) => ({ path: d.path, contentHash: d.contentHash }));
    const diff = diffScan(scanned, existing);

    let { generation, file: indexFile } = this.currentGenerationAndFile();
    const isFirstBuild = !existsSync(indexFile);
    if (mode === 'full' && !isFirstBuild) {
      generation += 1;
      indexFile = join(this.deps.indexesDir, generationFileName(INDEX_NAME, generation));
    }

    const index = this.deps.openIndex(indexFile);
    if (mode === 'incremental' && !isFirstBuild) index.load();

    const toProcess = [...diff.added, ...diff.changed];
    let done = 0;
    for (const scannedFile of toProcess) {
      await this.indexOneFile(scannedFile, index, generation);
      done += 1;
      onProgress?.({ phase: 'embed', done, total: toProcess.length, path: scannedFile.relPath });
    }
    for (const removedPath of diff.removed) {
      const removedIds = await this.deps.documents.deleteDocument(removedPath);
      for (const id of removedIds) index.remove(id);
    }

    index.save();
    const stats = index.stats();
    await this.deps.indexRepo.setMeta({
      name: INDEX_NAME,
      generation,
      dimensions: this.deps.provider.dimensions,
      modelId: this.deps.provider.modelId,
      vectorCount: stats.size,
      builtAt: new Date().toISOString(),
      filePath: indexFile,
    });
    await this.deps.indexRepo.clearDirty([...toProcess.map((f) => f.relPath), ...diff.removed]);
    if (mode === 'full') removeOtherGenerations(this.deps.indexesDir, INDEX_NAME, generation);

    onProgress?.({ phase: 'done', done: toProcess.length, total: toProcess.length });
    return {
      added: diff.added.length,
      changed: diff.changed.length,
      removed: diff.removed.length,
      unchanged: diff.unchanged,
      chunks: this.deps.documents.counts().chunks,
      generation,
    };
  }

  private async indexOneFile(file: ScannedFile, index: VectorIndex, generation: number): Promise<void> {
    const content = readFileSync(file.absPath, 'utf8');
    const chunks = await this.deps.chunker.chunk(file.relPath, content, file.language);
    const headers = chunks.map((c) => `${file.relPath} ${c.symbol ?? ''}\n${c.content}`);
    const embeddings: Float32Array[] = [];
    for (let i = 0; i < headers.length; i += EMBED_BATCH) {
      embeddings.push(...(await this.deps.provider.embedDocuments(headers.slice(i, i + EMBED_BATCH))));
    }
    const chunkInputs: ChunkInput[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const c = chunks[i]!;
      chunkInputs.push({
        kind: c.kind,
        symbol: c.symbol,
        identifiers: identifiersOf(c.content),
        startLine: c.startLine,
        endLine: c.endLine,
        content: c.content,
        contentHash: createHash('sha256').update(c.content).digest('hex'),
        tokenCount: await this.deps.provider.countTokens(c.content),
        embedding: embeddings[i] ?? null,
      });
    }
    const { inserted, removedVectorIds } = await this.deps.documents.replaceDocument(
      { path: file.relPath, language: file.language, sizeBytes: file.sizeBytes, contentHash: file.contentHash, gitCommit: null, indexGeneration: generation },
      chunkInputs,
    );
    for (const id of removedVectorIds) index.remove(id);
    for (let i = 0; i < inserted.length; i += 1) {
      const embedding = embeddings[i];
      if (embedding) index.add(inserted[i]!.vectorId, embedding);
    }
  }

  private async runRebuildVectors(onProgress?: (p: IndexProgress) => void): Promise<Omit<IndexReport, 'durationMs'>> {
    const { generation: currentGeneration } = this.currentGenerationAndFile();
    const nextGeneration = currentGeneration + 1;
    const file = join(this.deps.indexesDir, generationFileName(INDEX_NAME, nextGeneration));
    const index = this.deps.openIndex(file);
    const documents = this.deps.documents;
    const total = documents.counts().chunks;
    let done = 0;
    function* records(): Iterable<{ id: number; vector: Float32Array }> {
      for (const row of documents.iterateEmbeddings()) {
        done += 1;
        onProgress?.({ phase: 'vectors', done, total });
        yield { id: row.vectorId, vector: row.embedding };
      }
    }
    index.rebuild(records());
    const stats = index.stats();
    if (stats.size !== total) throw new Error(`rebuild-vectors produced ${stats.size} vectors but expected ${total}`);

    await this.deps.indexRepo.setMeta({
      name: INDEX_NAME,
      generation: nextGeneration,
      dimensions: this.deps.provider.dimensions,
      modelId: this.deps.provider.modelId,
      vectorCount: stats.size,
      builtAt: new Date().toISOString(),
      filePath: file,
    });
    removeOtherGenerations(this.deps.indexesDir, INDEX_NAME, nextGeneration);
    onProgress?.({ phase: 'done', done: total, total });
    return { added: 0, changed: 0, removed: 0, unchanged: total, chunks: total, generation: nextGeneration };
  }
}
