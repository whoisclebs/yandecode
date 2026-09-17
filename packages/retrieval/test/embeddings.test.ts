import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_HOST,
  QUERY_PREFIX,
  modelIsCached,
  resolveModelCacheDir,
  resolveModelHost,
  resolveModelPathTemplate,
} from '../src/embeddings/arctic.js';
import { HashEmbeddingProvider } from '../src/embeddings/hash-provider.js';
import { ApproxTokenCounter } from '../src/embeddings/provider.js';

const norm = (v: Float32Array): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const dot = (a: Float32Array, b: Float32Array): number =>
  a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

describe('HashEmbeddingProvider', () => {
  it('is deterministic, normalized and sized', async () => {
    const p = new HashEmbeddingProvider(16);
    const a = await p.embedDocument('jwt validator token');
    const b = await p.embedDocument('jwt validator token');
    expect(a).toEqual(b);
    expect(a.length).toBe(16);
    expect(norm(a)).toBeCloseTo(1, 5);
    expect(p.dimensions).toBe(16);
  });

  it('ranks overlapping text closer than unrelated text', async () => {
    const p = new HashEmbeddingProvider(64);
    const q = await p.embedQuery('jwt token validation');
    const near = await p.embedDocument('validate the jwt token signature');
    const far = await p.embedDocument('render button component css');
    expect(dot(q, near)).toBeGreaterThan(dot(q, far));
  });

  it('embedDocuments preserves order and countTokens counts words', async () => {
    const p = new HashEmbeddingProvider(8);
    const [x, y] = await p.embedDocuments(['alpha', 'beta']);
    expect(x).toEqual(await p.embedDocument('alpha'));
    expect(y).toEqual(await p.embedDocument('beta'));
    expect(await p.countTokens('one two  three')).toBe(3);
  });
});

describe('ApproxTokenCounter', () => {
  it('estimates 4 chars per token', async () => {
    expect(await new ApproxTokenCounter().countTokens('x'.repeat(10))).toBe(3);
    expect(await new ApproxTokenCounter().countTokens('')).toBe(0);
  });
});

describe('Arctic helpers', () => {
  it('uses the exact recommended query prefix', () => {
    expect(QUERY_PREFIX).toBe('Represent this sentence for searching relevant passages: ');
  });
  it('resolves the model cache dir from env', () => {
    expect(resolveModelCacheDir({ YANDECODE_MODEL_DIR: '/models' })).toBe('/models');
    expect(resolveModelCacheDir({ XDG_CACHE_HOME: '/xdg' })).toBe('/xdg/yandecode/models');
  });
  it('modelIsCached is false for an empty dir', () => {
    expect(modelIsCached('/definitely/not/here')).toBe(false);
  });
  it('defaults to the GitHub mirror, overridable via YANDECODE_MODEL_HOST', () => {
    expect(resolveModelHost({})).toBe(DEFAULT_MODEL_HOST);
    expect(resolveModelHost({ YANDECODE_MODEL_HOST: 'https://example.com/models/' })).toBe(
      'https://example.com/models/',
    );
  });
  it('uses the Hub-style path template only for huggingface.co/hf.co hosts', () => {
    expect(resolveModelPathTemplate(DEFAULT_MODEL_HOST)).toBe('{model}/');
    expect(resolveModelPathTemplate('https://huggingface.co/')).toBe('{model}/resolve/{revision}/');
    expect(resolveModelPathTemplate('https://hf.co/')).toBe('{model}/resolve/{revision}/');
    expect(resolveModelPathTemplate('not a url')).toBe('{model}/');
  });
});
