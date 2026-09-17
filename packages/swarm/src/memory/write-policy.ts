export const MAX_MEMORY_CONTENT_CHARS = 4000;

const CONTENT_SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:AKIA|ASIA)[0-9A-Z]{16}/,
  /(?:api[_-]?key|secret[_-]?key|secret|token|password)\s*[:=]\s*['"]?[A-Za-z0-9_-]{12,}['"]?/i,
];

export interface WritePolicyCandidate {
  content: string;
  // Optional: callers that don't pass one (e.g. existing tests written before this field existed)
  // are treated as if it were null - only content is scanned in that case.
  summary?: string | null;
  evidence: string | null;
  confidence: number;
}

export interface WritePolicyResult {
  allowed: boolean;
  reason: string | null;
}

export function evaluateWritePolicy(candidate: WritePolicyCandidate): WritePolicyResult {
  if (candidate.content.trim().length === 0) return { allowed: false, reason: 'empty content' };
  if (candidate.content.length > MAX_MEMORY_CONTENT_CHARS)
    return { allowed: false, reason: `content exceeds ${MAX_MEMORY_CONTENT_CHARS} characters` };
  if (!candidate.evidence || candidate.evidence.trim().length === 0)
    return { allowed: false, reason: 'no evidence provided' };
  if (candidate.confidence < 0 || candidate.confidence > 1)
    return { allowed: false, reason: 'confidence must be within [0, 1]' };
  // Scan both content and summary: summary is persisted and FTS-indexed just like content, so a
  // secret embedded only in the summary would otherwise sail past this gate.
  const scannedText = [candidate.content, candidate.summary].filter(
    (text): text is string => text != null,
  );
  for (const pattern of CONTENT_SECRET_PATTERNS) {
    if (scannedText.some((text) => pattern.test(text)))
      return { allowed: false, reason: 'content matches a secret-like pattern' };
  }
  return { allowed: true, reason: null };
}
