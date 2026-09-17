export function reciprocalRankFusion(lists: { id: number }[][], k = 60): { id: number; score: number }[] {
  const scores = new Map<number, number>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || a.id - b.id);
}
