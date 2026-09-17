import { describe, expect, it } from 'vitest';
import { maximalMarginalRelevance } from '../src/fusion/mmr.js';

describe('maximalMarginalRelevance', () => {
  it('promotes a dissimilar-but-relevant candidate over redundant near-duplicates', () => {
    const query = new Float32Array([1, 0, 0]);
    const candidates = [
      { id: 1, score: 0.9, vector: new Float32Array([0.8, 0.6, 0]) },
      { id: 2, score: 0.85, vector: new Float32Array([0.8, 0.6, 0]) },
      { id: 3, score: 0.8, vector: new Float32Array([0.8, 0.6, 0]) },
      { id: 4, score: 0.5, vector: new Float32Array([0.6, -0.8, 0]) },
    ];
    const order = maximalMarginalRelevance(query, candidates, 4, 0.5);
    expect(order.slice(0, 2)).toEqual([1, 4]);
  });

  it('treats candidates without a vector as having zero similarity to everything', () => {
    const query = new Float32Array([1, 0, 0]);
    const candidates = [
      { id: 1, score: 0.9, vector: new Float32Array([1, 0, 0]) },
      { id: 2, score: 0.1, vector: null },
    ];
    expect(maximalMarginalRelevance(query, candidates, 2, 0.7)).toEqual([1, 2]);
  });

  it('stops at the requested limit', () => {
    const query = new Float32Array([1, 0, 0]);
    const candidates = [
      { id: 1, score: 1, vector: new Float32Array([1, 0, 0]) },
      { id: 2, score: 1, vector: new Float32Array([0, 1, 0]) },
      { id: 3, score: 1, vector: new Float32Array([0, 0, 1]) },
    ];
    expect(maximalMarginalRelevance(query, candidates, 1, 0.7)).toHaveLength(1);
  });
});
