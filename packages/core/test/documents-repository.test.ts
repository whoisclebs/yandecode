import { describe, expect, it } from 'vitest';
import { DocumentRepository, type ChunkInput } from '../src/persistence/repositories/documents.js';
import { StateService } from '../src/persistence/state-service.js';

const chunk = (over: Partial<ChunkInput>): ChunkInput => ({
  kind: 'function', symbol: null, identifiers: '', startLine: 1, endLine: 3, content: 'x', contentHash: 'h', tokenCount: 1, embedding: null, ...over,
});
const doc = (path: string, hash = 'dh') => ({ path, language: 'typescript', sizeBytes: 10, contentHash: hash, gitCommit: null, indexGeneration: 1 });

describe('DocumentRepository', () => {
  it('inserts documents with monotonically allocated vector ids', async () => {
    const repo = new DocumentRepository(StateService.open(':memory:'));
    const a = await repo.replaceDocument(doc('a.ts'), [chunk({ content: 'one' }), chunk({ content: 'two' })]);
    const b = await repo.replaceDocument(doc('b.ts'), [chunk({ content: 'three' })]);
    expect(a.inserted.map((c) => c.vectorId)).toEqual([1, 2]);
    expect(b.inserted.map((c) => c.vectorId)).toEqual([3]);
    expect(a.removedVectorIds).toEqual([]);
    expect(repo.counts()).toEqual({ documents: 2, chunks: 3 });
    expect(repo.listDocuments().map((d) => d.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('replacing a document removes old chunks and never reuses vector ids', async () => {
    const repo = new DocumentRepository(StateService.open(':memory:'));
    await repo.replaceDocument(doc('a.ts'), [chunk({ content: 'one' }), chunk({ content: 'two' })]);
    const again = await repo.replaceDocument(doc('a.ts', 'dh2'), [chunk({ content: 'new' })]);
    expect(again.removedVectorIds.sort()).toEqual([1, 2]);
    expect(again.inserted[0]?.vectorId).toBe(3);
    expect(repo.allVectorIds()).toEqual([3]);
    expect(repo.listDocuments()[0]?.contentHash).toBe('dh2');
  });

  it('deleteDocument returns removed vector ids and cascades', async () => {
    const repo = new DocumentRepository(StateService.open(':memory:'));
    await repo.replaceDocument(doc('a.ts'), [chunk({}), chunk({})]);
    expect((await repo.deleteDocument('a.ts')).sort()).toEqual([1, 2]);
    expect(await repo.deleteDocument('missing.ts')).toEqual([]);
    expect(repo.counts()).toEqual({ documents: 0, chunks: 0 });
  });

  it('stores and returns embeddings, and iterates them', async () => {
    const repo = new DocumentRepository(StateService.open(':memory:'));
    await repo.replaceDocument(doc('a.ts'), [chunk({ embedding: new Float32Array([1, 0]) }), chunk({ embedding: new Float32Array([0, 1]) }), chunk({})]);
    const map = repo.embeddingsByVectorIds([2, 1, 3]);
    expect(Array.from(map.get(1)!)).toEqual([1, 0]);
    expect(Array.from(map.get(2)!)).toEqual([0, 1]);
    expect(map.has(3)).toBe(false);
    expect([...repo.iterateEmbeddings()].map((e) => e.vectorId)).toEqual([1, 2]);
  });

  it('chunksByVectorIds preserves the requested order and includes path', async () => {
    const repo = new DocumentRepository(StateService.open(':memory:'));
    await repo.replaceDocument(doc('a.ts'), [chunk({ symbol: 'f1' }), chunk({ symbol: 'f2' })]);
    const rows = repo.chunksByVectorIds([2, 1, 99]);
    expect(rows.map((r) => r.symbol)).toEqual(['f2', 'f1']);
    expect(rows[0]?.path).toBe('a.ts');
  });

  it('searchLexical ranks by BM25 across content, symbol and identifiers', async () => {
    const repo = new DocumentRepository(StateService.open(':memory:'));
    await repo.replaceDocument(doc('auth.ts'), [
      chunk({ symbol: 'JwtValidator.validate', identifiers: 'jwt validator validate', content: 'verify signature and expiry' }),
      chunk({ symbol: 'renderButton', identifiers: 'render button', content: 'return <button/>' }),
    ]);
    const hits = repo.searchLexical('jwt validator', 10);
    expect(hits[0]?.vectorId).toBe(1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.score).toBeGreaterThan(0);
    expect(repo.searchLexical('???', 10)).toEqual([]);
  });
});
