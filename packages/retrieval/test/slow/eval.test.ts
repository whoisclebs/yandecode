import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DocumentRepository,
  EventLog,
  EventRepository,
  IndexRepository,
  StateService,
} from '@yandecode/core';
import { describe, expect, it } from 'vitest';
import { createDefaultChunker } from '../../src/chunking/router.js';
import { ArcticEmbedXsProvider, resolveModelCacheDir } from '../../src/embeddings/arctic.js';
import { HybridRetriever } from '../../src/service/hybrid-retriever.js';
import { IndexingService } from '../../src/service/indexing-service.js';
import { USearchVectorIndex } from '../../src/vector/usearch-index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, '../../../../fixtures/repo-auth');
const EVAL_FILE = join(HERE, '../../../../benchmarks/rag/eval.json');

interface EvalQuery {
  query: string;
  expectedFiles: string[];
}

describe('retrieval quality (slow, real model)', () => {
  it('reaches Recall@5 >= 0.8 and MRR >= 0.6 on the repo-auth fixture', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yc-eval-'));
    const indexesDir = join(root, 'indexes');
    const state = StateService.open(':memory:');
    const documents = new DocumentRepository(state);
    const indexRepo = new IndexRepository(state);
    const events = new EventLog(new EventRepository(state), join(root, 'events.jsonl'));
    const provider = new ArcticEmbedXsProvider({ cacheDir: resolveModelCacheDir(process.env) });
    const chunker = createDefaultChunker(provider);
    const openIndex = (file: string | null): USearchVectorIndex =>
      new USearchVectorIndex({ dimensions: provider.dimensions, file });
    const indexing = new IndexingService({
      root: FIXTURE_ROOT,
      indexesDir,
      documents,
      indexRepo,
      provider,
      chunker,
      events,
      openIndex,
    });
    await indexing.run({ mode: 'incremental' });

    const meta = indexRepo.getMeta('repository');
    if (!meta) throw new Error('indexing did not produce metadata');
    const index = openIndex(meta.filePath);
    index.load();
    const retriever = new HybridRetriever({ documents, provider, index });

    const queries = JSON.parse(readFileSync(EVAL_FILE, 'utf8')) as EvalQuery[];
    let recallHits = 0;
    let reciprocalRankSum = 0;
    for (const q of queries) {
      const hits = await retriever.search(q.query, { limit: 5 });
      const paths = hits.map((h) => h.path);
      if (q.expectedFiles.some((f) => paths.includes(f))) recallHits += 1;
      const rank = paths.findIndex((p) => q.expectedFiles.includes(p));
      reciprocalRankSum += rank === -1 ? 0 : 1 / (rank + 1);
    }
    const recallAt5 = recallHits / queries.length;
    const mrr = reciprocalRankSum / queries.length;

    await provider.dispose();
    state.close();
    rmSync(root, { recursive: true, force: true });

    expect(recallAt5).toBeGreaterThanOrEqual(0.8);
    expect(mrr).toBeGreaterThanOrEqual(0.6);
  }, 600_000);
});
