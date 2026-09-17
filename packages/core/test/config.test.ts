import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  loadConfig,
  writeDefaultConfig,
  CONFIG_FILENAME,
} from '../src/config/load.js';
import { YandeCodeError } from '../src/errors.js';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'yc-config-'));

describe('config', () => {
  it('returns defaults when yandecode.json is missing', () => {
    expect(loadConfig(tmp())).toEqual(DEFAULT_CONFIG);
  });

  it('returns a fresh object per call when yandecode.json is missing (no shared singleton aliasing)', () => {
    const root = tmp();
    const first = loadConfig(root);
    const second = loadConfig(root);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('merges partial file over defaults', () => {
    const root = tmp();
    writeFileSync(join(root, CONFIG_FILENAME), JSON.stringify({ swarm: { maxAgents: 2 } }));
    const cfg = loadConfig(root);
    expect(cfg.swarm.maxAgents).toBe(2);
    expect(cfg.swarm.strategy).toBe('adaptive');
    expect(cfg.rag.embeddingModel).toBe('Snowflake/snowflake-arctic-embed-xs');
  });

  it('rejects maxAgents above the hard limit of 8', () => {
    const root = tmp();
    writeFileSync(join(root, CONFIG_FILENAME), JSON.stringify({ swarm: { maxAgents: 9 } }));
    expect(() => loadConfig(root)).toThrowError(YandeCodeError);
    expect(() => loadConfig(root)).toThrow(/CONFIG_INVALID/);
  });

  it('rejects malformed JSON with CONFIG_INVALID', () => {
    const root = tmp();
    writeFileSync(join(root, CONFIG_FILENAME), '{ not json');
    expect(() => loadConfig(root)).toThrow(/CONFIG_INVALID/);
  });

  it('writeDefaultConfig creates the file once and never overwrites', () => {
    const root = tmp();
    expect(writeDefaultConfig(root)).toBe(true);
    writeFileSync(join(root, CONFIG_FILENAME), JSON.stringify({ memory: { enabled: false } }));
    expect(writeDefaultConfig(root)).toBe(false);
    expect(JSON.parse(readFileSync(join(root, CONFIG_FILENAME), 'utf8'))).toEqual({
      memory: { enabled: false },
    });
  });
});
