import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocumentRepository, EventLog, EventRepository, IndexRepository, StateService } from '@yandecode/core';
import { ArcticEmbedXsProvider, createDefaultChunker, HybridRetriever, IndexingService, resolveModelCacheDir, USearchVectorIndex } from '@yandecode/retrieval';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, '../../fixtures/repo-auth');
const EVAL_FILE = join(HERE, 'eval.json');
const OUTPUT_DIR = join(HERE, '../../.yandecode/cache/benchmarks');

interface EvalQuery {
  query: string;
  expectedFiles: string[];
  expectedSymbols?: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] ?? 0;
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'yc-benchmark-'));
  const indexesDir = join(root, 'indexes');
  const state = StateService.open(':memory:');
  const documents = new DocumentRepository(state);
  const indexRepo = new IndexRepository(state);
  const events = new EventLog(new EventRepository(state), join(root, 'events.jsonl'));

  const modelLoadStart = Date.now();
  const provider = new ArcticEmbedXsProvider({ cacheDir: resolveModelCacheDir(process.env) });
  await provider.embedQuery('warm up the pipeline');
  const modelLoadMs = Date.now() - modelLoadStart;

  const chunker = createDefaultChunker(provider);
  const openIndex = (file: string | null): USearchVectorIndex => new USearchVectorIndex({ dimensions: provider.dimensions, file });
  const indexing = new IndexingService({ root: FIXTURE_ROOT, indexesDir, documents, indexRepo, provider, chunker, events, openIndex });

  const fullStart = Date.now();
  const fullReport = await indexing.run({ mode: 'incremental' });
  const fullIndexMs = Date.now() - fullStart;

  const noopStart = Date.now();
  await indexing.run({ mode: 'incremental' });
  const incrementalNoopMs = Date.now() - noopStart;

  const meta = indexRepo.getMeta('repository');
  if (!meta) throw new Error('indexing did not produce metadata');
  const index = openIndex(meta.filePath);
  index.load();
  const retriever = new HybridRetriever({ documents, provider, index });

  const queries = JSON.parse(readFileSync(EVAL_FILE, 'utf8')) as EvalQuery[];
  const latenciesMs: number[] = [];
  let recallAt1 = 0;
  let recallAt5 = 0;
  let recallAt10 = 0;
  let reciprocalRankSum = 0;

  for (let round = 0; round < 5; round += 1) {
    for (const q of queries) {
      const start = Date.now();
      const hits = await retriever.search(q.query, { limit: 10 });
      latenciesMs.push(Date.now() - start);
      if (round === 0) {
        const paths = hits.map((h) => h.path);
        if (q.expectedFiles.some((f) => paths.slice(0, 1).includes(f))) recallAt1 += 1;
        if (q.expectedFiles.some((f) => paths.slice(0, 5).includes(f))) recallAt5 += 1;
        if (q.expectedFiles.some((f) => paths.includes(f))) recallAt10 += 1;
        const rank = paths.findIndex((p) => q.expectedFiles.includes(p));
        reciprocalRankSum += rank === -1 ? 0 : 1 / (rank + 1);
      }
    }
  }
  latenciesMs.sort((a, b) => a - b);

  const result = {
    timestamp: new Date().toISOString(),
    modelLoadMs,
    embedThroughputChunksPerSecond: fullReport.chunks / (fullIndexMs / 1000),
    fullIndexMs,
    incrementalNoopMs,
    queryLatencyMsP50: percentile(latenciesMs, 50),
    queryLatencyMsP95: percentile(latenciesMs, 95),
    queryLatencyMsP99: percentile(latenciesMs, 99),
    rssBytes: process.memoryUsage().rss,
    vectorIndexBytes: statSync(meta.filePath).size,
    recallAt1: recallAt1 / queries.length,
    recallAt5: recallAt5 / queries.length,
    recallAt10: recallAt10 / queries.length,
    mrr: reciprocalRankSum / queries.length,
  };

  console.table(result);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, `${Date.now()}.json`), JSON.stringify(result, null, 2));

  await provider.dispose();
  state.close();
  rmSync(root, { recursive: true, force: true });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
