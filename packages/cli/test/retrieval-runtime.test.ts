import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HashEmbeddingProvider } from '@yandecode/retrieval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('reuses a passed-in shared provider instead of constructing its own, and never disposes it', async () => {
    const rt = openRuntime(dir);
    const sharedProvider = new HashEmbeddingProvider(64);
    const disposeSpy = vi.spyOn(sharedProvider, 'dispose');

    const retrieval = createRetrieval(rt, sharedProvider);
    expect(retrieval.provider).toBe(sharedProvider);
    await retrieval.dispose();
    expect(disposeSpy).not.toHaveBeenCalled();

    // A second createRetrieval call with the SAME shared provider still reuses it (never rebuilds
    // its own), confirming the provider genuinely outlives any one retrieval instance.
    const retrieval2 = createRetrieval(rt, sharedProvider);
    expect(retrieval2.provider).toBe(sharedProvider);
    await retrieval2.dispose();
    expect(disposeSpy).not.toHaveBeenCalled();

    rt.close();
  });

  it('disposes its own internally-created provider when no shared provider is passed', async () => {
    process.env.YANDECODE_EMBEDDINGS = 'hash';
    const rt = openRuntime(dir);
    const retrieval = createRetrieval(rt);
    const disposeSpy = vi.spyOn(retrieval.provider, 'dispose');
    await retrieval.dispose();
    expect(disposeSpy).toHaveBeenCalledOnce();
    rt.close();
  });
});
