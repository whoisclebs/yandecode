import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateService } from '../src/persistence/state-service.js';
import { MemoryRepository, type MemoryInput } from '../src/persistence/repositories/memories.js';

let dir: string;
let state: StateService;
let repo: MemoryRepository;

function input(overrides: Partial<MemoryInput> = {}): MemoryInput {
  return {
    namespace: 'patterns',
    content:
      'Use StateService.write for every mutation, never touch db directly outside a repository.',
    summary: 'Serialize writes through StateService',
    sourceSwarmId: null,
    sourceTaskId: null,
    confidence: 0.6,
    contentHash: 'hash-1',
    embedding: new Float32Array([1, 0, 0]),
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yc-memories-'));
  state = StateService.open(join(dir, 'state.db'));
  repo = new MemoryRepository(state);
});

afterEach(() => {
  state.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('MemoryRepository', () => {
  it('creates a memory with an allocated vector id starting at 1', async () => {
    const rec = await repo.create(input());
    expect(rec.id).toBeTruthy();
    expect(rec.vectorId).toBe(1);
    expect(rec.namespace).toBe('patterns');
    expect(rec.usageCount).toBe(0);
    expect(rec.confidence).toBeCloseTo(0.6, 10);
  });

  it('allocates monotonically increasing vector ids across creates', async () => {
    const a = await repo.create(input({ contentHash: 'hash-a' }));
    const b = await repo.create(input({ contentHash: 'hash-b' }));
    expect(b.vectorId).toBe(a.vectorId + 1);
  });

  it('finds a memory by content hash', async () => {
    await repo.create(input({ contentHash: 'unique-hash' }));
    expect(repo.findByContentHash('unique-hash')?.contentHash).toBe('unique-hash');
    expect(repo.findByContentHash('missing')).toBeNull();
  });

  it('returns memories by vector id in the requested order', async () => {
    const a = await repo.create(input({ contentHash: 'a' }));
    const b = await repo.create(input({ contentHash: 'b' }));
    expect(repo.byVectorIds([b.vectorId, a.vectorId]).map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('round-trips embeddings by vector id', async () => {
    const rec = await repo.create(input({ embedding: new Float32Array([0.1, 0.2, 0.3]) }));
    const map = repo.embeddingsByVectorIds([rec.vectorId]);
    expect(Array.from(map.get(rec.vectorId) ?? [])).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ]);
  });

  it('iterates all embeddings in vector-id order', async () => {
    await repo.create(input({ contentHash: 'a', embedding: new Float32Array([1, 0, 0]) }));
    await repo.create(input({ contentHash: 'b', embedding: new Float32Array([0, 1, 0]) }));
    const rows = [...repo.iterateEmbeddings()];
    expect(rows.map((r) => r.vectorId)).toEqual([1, 2]);
  });

  it('searches lexically, optionally scoped by namespace, ranking better matches higher', async () => {
    await repo.create(
      input({
        contentHash: 'a',
        namespace: 'patterns',
        content: 'retry idle connections with exponential backoff',
        summary: 'retry backoff pattern',
      }),
    );
    await repo.create(
      input({
        contentHash: 'b',
        namespace: 'failures',
        content: 'the deploy failed because the health check timed out',
        summary: 'deploy failure',
      }),
    );
    const all = repo.searchLexical('backoff', null, 10);
    expect(all.length).toBe(1);
    const scoped = repo.searchLexical('deploy', 'patterns', 10);
    expect(scoped.length).toBe(0);
    const scopedHit = repo.searchLexical('deploy', 'failures', 10);
    expect(scopedHit.length).toBe(1);
  });

  it('records usage and updates success/failure counts and lastUsedAt', async () => {
    const rec = await repo.create(input());
    await repo.recordUsage(rec.id, 'success');
    await repo.recordUsage(rec.id, 'failure');
    const updated = repo.get(rec.id);
    expect(updated?.usageCount).toBe(2);
    expect(updated?.successCount).toBe(1);
    expect(updated?.failureCount).toBe(1);
    expect(updated?.lastUsedAt).not.toBeNull();
  });

  it('applies feedback, clamping confidence to [0, 1] and recording the feedback row', async () => {
    const rec = await repo.create(input({ confidence: 0.9 }));
    await repo.applyFeedback({
      memoryId: rec.id,
      taskId: null,
      verdict: 'helpful',
      note: 'worked great',
      confidenceDelta: 0.3,
    });
    expect(repo.get(rec.id)?.confidence).toBeCloseTo(1, 10);
    await repo.applyFeedback({
      memoryId: rec.id,
      taskId: null,
      verdict: 'wrong',
      note: null,
      confidenceDelta: -1.5,
    });
    expect(repo.get(rec.id)?.confidence).toBeCloseTo(0, 10);
  });
});
