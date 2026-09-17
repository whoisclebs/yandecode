import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HashEmbeddingProvider } from '@yandecode/retrieval';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRuntime } from '../src/context.js';
import { createRetrieval } from '../src/retrieval-runtime.js';

let dir: string;
let previousFlag: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yc-retrieval-runtime-'));
  writeFileSync(join(dir, 'yandecode.json'), '{}');
  previousFlag = process.env.YANDECODE_EMBEDDINGS;
});

afterEach(() => {
  if (previousFlag === undefined) delete process.env.YANDECODE_EMBEDDINGS;
  else process.env.YANDECODE_EMBEDDINGS = previousFlag;
});

describe('createRetrieval', () => {
  it('uses the hash embedding provider when YANDECODE_EMBEDDINGS=hash', async () => {
    process.env.YANDECODE_EMBEDDINGS = 'hash';
    const rt = openRuntime(dir);
    const retrieval = createRetrieval(rt);
    expect(retrieval.provider).toBeInstanceOf(HashEmbeddingProvider);
    await retrieval.dispose();
    rt.close();
  });

  it('wires the indexing service and retriever to the same documents repository', async () => {
    process.env.YANDECODE_EMBEDDINGS = 'hash';
    const rt = openRuntime(dir);
    const retrieval = createRetrieval(rt);
    await retrieval.indexing.run({ mode: 'incremental' });
    expect(retrieval.indexing.status().documents).toBe(0);
    await retrieval.dispose();
    rt.close();
  });
});
