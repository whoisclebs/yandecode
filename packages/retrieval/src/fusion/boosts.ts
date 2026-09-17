export interface BoostCandidate {
  id: number;
  score: number;
  symbol: string | null;
  path: string;
}

const SYMBOL_BOOST = 0.05;
const TEST_PATH_BOOST = 0.02;
const TEST_PATH_RE = /(\.|_|\/)(test|spec)s?(\.|\/)/i;

function lastSegment(symbol: string): string {
  const parts = symbol.split(/[.:#]/).filter((p) => p.length > 0);
  return (parts[parts.length - 1] ?? symbol).toLowerCase();
}

export function applyBoosts<T extends BoostCandidate>(candidates: T[], query: string): T[] {
  const tokens = new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );
  const wantsTest = tokens.has('test') || tokens.has('tests') || tokens.has('spec') || tokens.has('specs');
  return candidates.map((c) => {
    let boosted = c.score;
    if (c.symbol && tokens.has(lastSegment(c.symbol))) boosted += SYMBOL_BOOST;
    if (wantsTest && TEST_PATH_RE.test(c.path)) boosted += TEST_PATH_BOOST;
    return boosted === c.score ? c : { ...c, score: boosted };
  });
}
