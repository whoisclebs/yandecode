import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentRepository, EventLog, EventRepository, IndexRepository, StateService } from '@yandecode/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LineChunker } from '../src/chunking/line-chunker.js';
import { HashEmbeddingProvider } from '../src/embeddings/hash-provider.js';
import { IndexingService } from '../src/service/indexing-service.js';
import { USearchVectorIndex } from '../src/vector/usearch-index.js';

let root: string;
let indexesDir: string;
let state: StateService;
let provider: HashEmbeddingProvider;
let service: IndexingService;

function makeService(): IndexingService {
  provider = new HashEmbeddingProvider(16);
  return new IndexingService({
    root,
    indexesDir,
    documents: new DocumentRepository(state),
    indexRepo: new IndexRepository(state),
    provider,
    chunker: new LineChunker(provider),
    events: new EventLog(new EventRepository(state), join(root, '.yandecode', 'events.jsonl')),
    openIndex: (file) => new USearchVectorIndex({ dimensions: provider.dimensions, file }),
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'yc-indexing-'));
  indexesDir = join(root, '.yandecode', 'indexes');
  state = StateService.open(':memory:');
  writeFileSync(join(root, 'a.ts'), 'export function add(a: number, b: number): number {\n  return a + b;\n}\n');
  writeFileSync(join(root, 'b.ts'), 'export function sub(a: number, b: number): number {\n  return a - b;\n}\n');
  service = makeService();
});

afterEach(() => {
  state.close();
  rmSync(root, { recursive: true, force: true });
});

describe('IndexingService', () => {
  it('indexes fixture files on the first incremental run', async () => {
    const report = await service.run({ mode: 'incremental' });
    expect(report).toMatchObject({ added: 2, changed: 0, removed: 0, generation: 1 });
    const status = service.status();
    expect(status.documents).toBe(2);
    expect(status.inSync).toBe(true);
    expect(existsSync(status.vectorFile!)).toBe(true);
  });

  it('reports everything unchanged and adds nothing on a second no-op run', async () => {
    await service.run({ mode: 'incremental' });
    const report = await service.run({ mode: 'incremental' });
    expect(report).toMatchObject({ added: 0, changed: 0, removed: 0, unchanged: 2 });
  });

  it('re-indexes only a modified file and assigns it new vector ids', async () => {
    await service.run({ mode: 'incremental' });
    const documents = new DocumentRepository(state);
    const beforeIds = documents.chunksByVectorIds(documents.allVectorIds()).filter((c) => c.path === 'a.ts').map((c) => c.vectorId);

    writeFileSync(join(root, 'a.ts'), 'export function add(a: number, b: number): number {\n  return a + b + 0;\n}\n');
    const report = await service.run({ mode: 'incremental' });
    expect(report).toMatchObject({ added: 0, changed: 1, removed: 0 });

    const afterIds = documents.chunksByVectorIds(documents.allVectorIds()).filter((c) => c.path === 'a.ts').map((c) => c.vectorId);
    for (const id of afterIds) expect(beforeIds).not.toContain(id);
  });

  it('deletes chunks and vectors for a removed file', async () => {
    await service.run({ mode: 'incremental' });
    rmSync(join(root, 'b.ts'));
    const report = await service.run({ mode: 'incremental' });
    expect(report.removed).toBe(1);
    expect(service.status().documents).toBe(1);
  });

  it('rebuild-vectors produces a new generation without re-embedding and prunes the old file', async () => {
    await service.run({ mode: 'incremental' });
    const before = service.status();
    const report = await service.run({ mode: 'rebuild-vectors' });
    expect(report.generation).toBe(2);
    const after = service.status();
    expect(after.vectorFile).not.toBe(before.vectorFile);
    expect(existsSync(before.vectorFile!)).toBe(false);
    expect(existsSync(after.vectorFile!)).toBe(true);
    expect(after.vectorCount).toBe(after.chunks);
  });

  it('keeps generation and meta unchanged when rebuild-vectors crashes before committing', async () => {
    await service.run({ mode: 'incremental' });
    const before = service.status();
    const crashingService = new IndexingService({
      root,
      indexesDir,
      documents: new DocumentRepository(state),
      indexRepo: new IndexRepository(state),
      provider,
      chunker: new LineChunker(provider),
      events: new EventLog(new EventRepository(state), join(root, '.yandecode', 'events.jsonl')),
      openIndex: () => {
        throw new Error('simulated native load failure');
      },
    });
    await expect(crashingService.run({ mode: 'rebuild-vectors' })).rejects.toThrow('simulated native load failure');
    const after = service.status();
    expect(after.generation).toBe(before.generation);
    expect(after.vectorFile).toBe(before.vectorFile);
  });

  it('reports out of sync after the vector index file is deleted', async () => {
    await service.run({ mode: 'incremental' });
    const status = service.status();
    rmSync(status.vectorFile!);
    expect(service.status().inSync).toBe(false);
  });

  it('full mode reprocesses every file and bumps the generation', async () => {
    await service.run({ mode: 'incremental' });
    const report = await service.run({ mode: 'full' });
    expect(report).toMatchObject({ added: 2, generation: 2 });
    expect(service.status().inSync).toBe(true);
  });
});
