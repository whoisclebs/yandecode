export interface MmrCandidate {
  id: number;
  score: number;
  vector: Float32Array | null;
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const denom = Math.sqrt(dot(a, a)) * Math.sqrt(dot(b, b));
  return denom === 0 ? 0 : dot(a, b) / denom;
}

export function maximalMarginalRelevance<T extends MmrCandidate>(
  query: Float32Array,
  candidates: T[],
  limit: number,
  lambda = 0.7,
): number[] {
  const relevance = new Map(
    candidates.map((c) => [c.id, c.vector ? cosineSimilarity(query, c.vector) : 0]),
  );
  const remaining = [...candidates];
  const selected: T[] = [];

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i]!;
      const rel = relevance.get(candidate.id) ?? 0;
      let maxSim = 0;
      for (const s of selected) {
        if (!candidate.vector || !s.vector) continue;
        maxSim = Math.max(maxSim, cosineSimilarity(candidate.vector, s.vector));
      }
      const mmrScore = lambda * rel - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = i;
      }
    }
    selected.push(remaining[bestIndex]!);
    remaining.splice(bestIndex, 1);
  }
  return selected.map((c) => c.id);
}
