import { describe, expect, it } from 'vitest';
import {
  ArcticEmbedXsProvider,
  modelIsCached,
  resolveModelCacheDir,
} from '../../src/embeddings/arctic.js';

const dot = (a: Float32Array, b: Float32Array): number =>
  a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

describe('ArcticEmbedXsProvider (downloads the model once)', () => {
  it('embeds 384-d normalized vectors with CLS pooling and ranks relevant code higher', async () => {
    const cacheDir = resolveModelCacheDir();
    const p = new ArcticEmbedXsProvider({ cacheDir });
    const q = await p.embedQuery('where is the JWT token validated?');
    const [jwt, button] = await p.embedDocuments([
      'export class JwtValidator { validate(token: string) { /* verify signature and expiry */ } }',
      'export function Button(props) { return <button className="primary">{props.label}</button>; }',
    ]);
    expect(q.length).toBe(384);
    expect(Math.sqrt(dot(q, q))).toBeCloseTo(1, 3);
    expect(dot(q, jwt!)).toBeGreaterThan(dot(q, button!));
    expect(await p.countTokens('export class JwtValidator {}')).toBeGreaterThan(3);
    expect(modelIsCached(cacheDir)).toBe(true);
    await p.dispose();
  });
});
