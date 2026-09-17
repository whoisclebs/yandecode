import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryRepository } from '@yandecode/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRuntime } from '../src/context.js';
import { createSwarmRuntime } from '../src/swarm-runtime.js';

let dir: string;
let previousFlag: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yc-swarm-runtime-'));
  writeFileSync(join(dir, 'yandecode.json'), '{}');
  previousFlag = process.env.YANDECODE_EMBEDDINGS;
  process.env.YANDECODE_EMBEDDINGS = 'hash';
});

afterEach(() => {
  if (previousFlag === undefined) delete process.env.YANDECODE_EMBEDDINGS;
  else process.env.YANDECODE_EMBEDDINGS = previousFlag;
});

describe('createSwarmRuntime', () => {
  it('persists the memory vector_index_meta row synchronously, not as a dropped fire-and-forget write', async () => {
    const rt = openRuntime(dir);
    await createSwarmRuntime(rt);
    const meta = rt.index.getMeta('memory');
    expect(meta).not.toBeNull();
    expect(meta?.name).toBe('memory');
    rt.close();
  });

  it('reuses the existing memory index file/meta on a second call rather than recreating it', async () => {
    const rt = openRuntime(dir);
    await createSwarmRuntime(rt);
    const firstMeta = rt.index.getMeta('memory');
    await createSwarmRuntime(rt);
    const secondMeta = rt.index.getMeta('memory');
    expect(secondMeta?.filePath).toBe(firstMeta?.filePath);
    rt.close();
  });

  it('does not wipe the memory index on a normal reload once it is already in sync', async () => {
    const rt = openRuntime(dir);
    const first = await createSwarmRuntime(rt);
    const stored = await first.memoryService.store({
      namespace: 'patterns',
      content: 'a pattern worth remembering for the reload test',
      summary: null,
      sourceSwarmId: null,
      sourceTaskId: null,
      confidence: 0.6,
      evidence: 'task-1',
    });
    expect(stored.status).toBe('stored');

    // A brand-new createSwarmRuntime call, as a fresh process would make, loads the index (already
    // in sync, since store() called index.save()) and must NOT wipe the stored memory on reload.
    const second = await createSwarmRuntime(rt);
    const hits = await second.memoryRetriever.search('pattern worth remembering reload');
    expect(hits.some((h) => h.id === (stored as { memory: { id: string } }).memory.id)).toBe(true);
    rt.close();
  });

  it('rebuilds the on-disk memory index from the memories table when the two are genuinely out of sync', async () => {
    const rt = openRuntime(dir);
    // Bootstrap the empty index/meta first.
    await createSwarmRuntime(rt);

    // Simulate drift: insert a memory directly at the repository layer, bypassing MemoryService
    // entirely (so index.add()/save() never run) - as if a row were written by one process while
    // the on-disk .usearch file from another process was lost, corrupted, or never regenerated.
    const memories = new MemoryRepository(rt.state);
    const embedding = new Float32Array(64).fill(0.1);
    const direct = await memories.create({
      namespace: 'patterns',
      content: 'inserted directly, bypassing the vector index',
      summary: null,
      sourceSwarmId: null,
      sourceTaskId: null,
      confidence: 0.5,
      contentHash: 'direct-insert-hash',
      embedding,
    });

    // The next createSwarmRuntime call must detect the size mismatch (index has 0 vectors, the
    // memories table has 1 row) and rebuild the index from iterateEmbeddings() - not silently
    // keep operating on (and risk later overwriting) an incomplete index.
    const rebuilt = await createSwarmRuntime(rt);
    const hits = await rebuilt.memoryRetriever.search('inserted directly bypassing');
    expect(hits.some((h) => h.id === direct.id)).toBe(true);
    rt.close();
  });
});
