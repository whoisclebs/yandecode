import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRuntime, tryOpenRuntime } from '../src/context.js';

describe('openRuntime', () => {
  it('throws WORKSPACE_NOT_INITIALIZED without yandecode.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yc-ctx-none-'));
    expect(() => openRuntime(dir)).toThrow(/WORKSPACE_NOT_INITIALIZED/);
    expect(tryOpenRuntime(dir)).toBeNull();
  });

  it('opens state.db and creates the .yandecode tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yc-ctx-'));
    writeFileSync(join(dir, 'yandecode.json'), '{}');
    const rt = openRuntime(dir);
    expect(existsSync(rt.paths.stateDb)).toBe(true);
    expect(existsSync(rt.paths.logsDir)).toBe(true);
    expect(rt.config.rag.maxResults).toBe(8);
    expect(rt.index.counts()).toEqual({ documents: 0, chunks: 0 });
    rt.close();
  });
});
