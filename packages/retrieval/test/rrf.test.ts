import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from '../src/fusion/rrf.js';

describe('reciprocalRankFusion', () => {
  it('sums 1/(k+rank+1) contributions across lists and breaks ties by ascending id', () => {
    const result = reciprocalRankFusion(
      [
        [{ id: 1 }, { id: 2 }, { id: 3 }],
        [{ id: 2 }, { id: 1 }, { id: 4 }],
      ],
      60,
    );
    expect(result.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(result[0]?.score).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(result[1]?.score).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(result[2]?.score).toBeCloseTo(1 / 63, 10);
    expect(result[3]?.score).toBeCloseTo(1 / 63, 10);
  });

  it('includes items present in only one list with their single contribution', () => {
    const result = reciprocalRankFusion([[{ id: 5 }], []], 60);
    expect(result).toEqual([{ id: 5, score: 1 / 61 }]);
  });

  it('returns an empty array for two empty lists', () => {
    expect(reciprocalRankFusion([[], []], 60)).toEqual([]);
  });
});
