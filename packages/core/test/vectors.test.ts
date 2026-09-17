import { describe, expect, it } from 'vitest';
import { blobToVector, vectorToBlob } from '../src/persistence/vectors.js';

describe('vector blobs', () => {
  it('round-trips a Float32Array through a Buffer', () => {
    const v = new Float32Array([0.5, -1.25, 3]);
    const blob = vectorToBlob(v);
    expect(blob.length).toBe(12);
    expect(Array.from(blobToVector(blob))).toEqual([0.5, -1.25, 3]);
  });

  it('copies so the source buffer can be mutated safely', () => {
    const v = new Float32Array([1, 2]);
    const blob = vectorToBlob(v);
    v[0] = 9;
    expect(blobToVector(blob)[0]).toBe(1);
  });
});
