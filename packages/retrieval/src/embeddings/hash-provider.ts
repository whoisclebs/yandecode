import type { EmbeddingProvider } from './provider.js';

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic test double — never use for real embeddings/search. */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = 'hash-embedding-test-double';

  constructor(readonly dimensions: number = 32) {}

  private embed(text: string): Float32Array {
    const v = new Float32Array(this.dimensions);
    const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
    for (const t of tokens) {
      const idx = fnv1a(t) % this.dimensions;
      v[idx] = (v[idx] ?? 0) + 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    const result = new Float32Array(this.dimensions);
    for (let i = 0; i < v.length; i++) {
      result[i] = (v[i] ?? 0) / norm;
    }
    return result;
  }

  embedQuery(text: string): Promise<Float32Array> {
    return Promise.resolve(this.embed(text));
  }

  embedDocument(text: string): Promise<Float32Array> {
    return Promise.resolve(this.embed(text));
  }

  embedDocuments(texts: string[]): Promise<Float32Array[]> {
    return Promise.resolve(texts.map((t) => this.embed(t)));
  }

  countTokens(text: string): Promise<number> {
    return Promise.resolve(text.split(/\s+/).filter((t) => t.length > 0).length);
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
