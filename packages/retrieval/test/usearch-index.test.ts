import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generationFileName,
  listGenerations,
  removeOtherGenerations,
} from '../src/vector/generations.js';
import type { VectorRecord } from '../src/vector/types.js';
import { USearchVectorIndex } from '../src/vector/usearch-index.js';

function tmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yc-usearch-'));
  return join(dir, generationFileName('repository', 1));
}

describe('USearchVectorIndex', () => {
  it('adds, searches, removes and reports contains', () => {
    const index = new USearchVectorIndex({ dimensions: 3, file: null });
    index.add(1, new Float32Array([1, 0, 0]));
    index.add(2, new Float32Array([0, 1, 0]));
    index.add(3, new Float32Array([0.9, 0.1, 0]));
    expect(index.contains(1)).toBe(true);

    const hits = index.search(new Float32Array([1, 0, 0]), 2);
    expect(hits.map((h) => h.id)).toEqual([1, 3]);
    expect(hits[0]?.score).toBeCloseTo(1, 5);

    index.remove(2);
    expect(index.contains(2)).toBe(false);
    expect(index.stats()).toEqual({ size: 2, dimensions: 3, file: null });
  });

  it('returns an empty list when searching an empty index', () => {
    const index = new USearchVectorIndex({ dimensions: 3, file: null });
    expect(index.search(new Float32Array([1, 0, 0]), 5)).toEqual([]);
  });

  it('saves to and loads from disk, round-tripping search results', () => {
    const file = tmpFile();
    const a = new USearchVectorIndex({ dimensions: 3, file });
    a.add(10, new Float32Array([1, 0, 0]));
    a.add(11, new Float32Array([0, 1, 0]));
    a.save();
    expect(existsSync(file)).toBe(true);

    const b = new USearchVectorIndex({ dimensions: 3, file });
    b.load();
    expect(b.stats().size).toBe(2);
    expect(b.search(new Float32Array([1, 0, 0]), 1)[0]?.id).toBe(10);
  });

  it('rebuild replaces the index atomically and leaves the file untouched on a mid-rebuild crash', () => {
    const file = tmpFile();
    const original = new USearchVectorIndex({ dimensions: 3, file });
    original.add(1, new Float32Array([1, 0, 0]));
    original.save();
    const beforeMtime = statSync(file).mtimeMs;

    function* throwingRecords(): Iterable<VectorRecord> {
      yield { id: 99, vector: new Float32Array([0, 0, 1]) };
      throw new Error('boom');
    }
    expect(() => original.rebuild(throwingRecords())).toThrow('boom');
    expect(statSync(file).mtimeMs).toBe(beforeMtime);

    const reloaded = new USearchVectorIndex({ dimensions: 3, file });
    reloaded.load();
    expect(reloaded.contains(1)).toBe(true);
    expect(reloaded.contains(99)).toBe(false);

    function* records(): Iterable<VectorRecord> {
      yield { id: 5, vector: new Float32Array([0, 1, 0]) };
      yield { id: 6, vector: new Float32Array([0, 0, 1]) };
    }
    original.rebuild(records());
    expect(existsSync(file)).toBe(true);
    expect(original.contains(1)).toBe(false);
    expect(original.contains(5)).toBe(true);
    expect(original.stats().size).toBe(2);
  });
});

describe('generations', () => {
  it('formats zero-padded generation file names', () => {
    expect(generationFileName('repository', 1)).toBe('repository-00001.usearch');
    expect(generationFileName('memory', 42)).toBe('memory-00042.usearch');
  });

  it('lists and prunes generation files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yc-generations-'));
    for (const generation of [1, 2, 3]) {
      new USearchVectorIndex({
        dimensions: 3,
        file: join(dir, generationFileName('repository', generation)),
      }).save();
    }
    expect(listGenerations(dir, 'repository')).toEqual([1, 2, 3]);
    removeOtherGenerations(dir, 'repository', 3);
    expect(listGenerations(dir, 'repository')).toEqual([3]);
  });
});
