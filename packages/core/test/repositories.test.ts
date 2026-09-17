import { describe, expect, it } from 'vitest';
import { EventRepository } from '../src/persistence/repositories/events.js';
import { IndexRepository } from '../src/persistence/repositories/index-meta.js';
import { SessionRepository } from '../src/persistence/repositories/sessions.js';
import { StateService } from '../src/persistence/state-service.js';

describe('SessionRepository', () => {
  it('starts, finds and ends sessions by Claude session id', async () => {
    const state = StateService.open(':memory:');
    const repo = new SessionRepository(state);
    const s = await repo.start({ claudeSessionId: 'abc', cwd: '/repo' });
    expect(s.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(repo.findOpenByClaudeId('abc')?.id).toBe(s.id);
    await repo.setCompactSummary('abc', 'indexing pending');
    expect(repo.findOpenByClaudeId('abc')?.compactSummary).toBe('indexing pending');
    expect(await repo.end('abc', 'prompt_input_exit')).toBe(1);
    expect(repo.findOpenByClaudeId('abc')).toBeNull();
    expect(await repo.end('abc', 'again')).toBe(0);
  });

  it('getMostRecentOpen returns the most recently started still-open session, or null when none is open', async () => {
    const state = StateService.open(':memory:');
    const repo = new SessionRepository(state);
    expect(repo.getMostRecentOpen()).toBeNull();
    const first = await repo.start({ claudeSessionId: 'first', cwd: '/repo' });
    const second = await repo.start({ claudeSessionId: 'second', cwd: '/repo' });
    expect(repo.getMostRecentOpen()?.id).toBe(second.id);
    await repo.end('second', 'exit');
    expect(repo.getMostRecentOpen()?.id).toBe(first.id);
    await repo.end('first', 'exit');
    expect(repo.getMostRecentOpen()).toBeNull();
  });
});

describe('EventRepository', () => {
  it('records and lists events newest first', async () => {
    const state = StateService.open(':memory:');
    const repo = new EventRepository(state);
    await repo.record({ event: 'session_started', data: { cwd: '/r' } });
    const e2 = await repo.record({ event: 'index_completed', agent: 'cli', durationMs: 42 });
    const recent = repo.recent(10);
    expect(recent[0]).toEqual(e2);
    expect(recent).toHaveLength(2);
    expect(recent[1]?.data).toEqual({ cwd: '/r' });
  });
});

describe('IndexRepository', () => {
  it('stores vector index meta and manages the dirty queue', async () => {
    const state = StateService.open(':memory:');
    const repo = new IndexRepository(state);
    expect(repo.getMeta('repository')).toBeNull();
    await repo.setMeta({
      name: 'repository',
      generation: 1,
      dimensions: 384,
      modelId: 'm',
      vectorCount: 0,
      builtAt: 'now',
      filePath: 'repository-00001.usearch',
    });
    await repo.setMeta({
      name: 'repository',
      generation: 2,
      dimensions: 384,
      modelId: 'm',
      vectorCount: 5,
      builtAt: 'later',
      filePath: 'repository-00002.usearch',
    });
    expect(repo.getMeta('repository')?.generation).toBe(2);
    await repo.markDirty('src/a.ts', 'Write');
    await repo.markDirty('src/a.ts', 'Edit');
    await repo.markDirty('src/b.ts', 'Write');
    expect(repo.listDirty().map((d) => d.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(repo.listDirty()[0]?.reason).toBe('Edit');
    await repo.clearDirty(['src/a.ts']);
    expect(repo.listDirty().map((d) => d.path)).toEqual(['src/b.ts']);
    expect(repo.counts()).toEqual({ documents: 0, chunks: 0 });
  });
});
