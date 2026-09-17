import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentRepository, StateService } from '@yandecode/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HashEmbeddingProvider } from '../src/embeddings/hash-provider.js';
import { HybridRetriever, type HybridRetrieverConstants } from '../src/service/hybrid-retriever.js';
import { USearchVectorIndex } from '../src/vector/usearch-index.js';

const SINGLETON_TOPK: HybridRetrieverConstants = {
  denseTopK: 1,
  lexicalTopK: 1,
  rrfK: 60,
  mmrLambda: 0.7,
  maxResults: 12,
  tokenBudget: 6000,
};

let root: string;
let state: StateService;
let documents: DocumentRepository;
let provider: HashEmbeddingProvider;
let index: USearchVectorIndex;

async function addChunk(path: string, content: string, embeddedText: string): Promise<void> {
  const [embedding] = await provider.embedDocuments([embeddedText]);
  const { inserted } = await documents.replaceDocument(
    {
      path,
      language: 'text',
      sizeBytes: content.length,
      contentHash: path,
      gitCommit: null,
      indexGeneration: 1,
    },
    [
      {
        kind: 'text',
        symbol: null,
        identifiers: content.toLowerCase(),
        startLine: 1,
        endLine: 1,
        content,
        contentHash: path,
        tokenCount: 20,
        embedding: embedding ?? null,
      },
    ],
  );
  index.add(inserted[0]!.vectorId, embedding!);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'yc-hybrid-'));
  state = StateService.open(':memory:');
  documents = new DocumentRepository(state);
  provider = new HashEmbeddingProvider(64);
  index = new USearchVectorIndex({
    dimensions: provider.dimensions,
    file: join(root, 'repository-00001.usearch'),
  });

  // Dense-only: no literal overlap with the query in its stored content, but embedded from text close to the query.
  await addChunk(
    'src/dense-only.ts',
    'rotates the signing material on a schedule',
    'token rotation policy',
  );
  // Lexical-only: literal query tokens in its stored content, but embedded from unrelated text.
  await addChunk(
    'src/lexical-only.ts',
    'this file documents token rotation for session credentials',
    'weather forecast for tomorrow',
  );

  index.save();
});

afterEach(() => {
  state.close();
  rmSync(root, { recursive: true, force: true });
});

describe('HybridRetriever', () => {
  it('fuses a dense-only match and a lexical-only match that neither single-best channel alone would return together', async () => {
    const retriever = new HybridRetriever({
      documents,
      provider,
      index,
      constants: SINGLETON_TOPK,
    });
    const hits = await retriever.search('token rotation', { limit: 5 });
    expect(hits.map((h) => h.path).sort()).toEqual(['src/dense-only.ts', 'src/lexical-only.ts']);
  });

  it('returns an empty list when the vector index is empty', async () => {
    const emptyIndex = new USearchVectorIndex({ dimensions: provider.dimensions, file: null });
    const retriever = new HybridRetriever({ documents, provider, index: emptyIndex });
    expect(await retriever.search('token rotation', { limit: 5 })).toEqual([]);
  });
});
