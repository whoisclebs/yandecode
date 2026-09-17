export const MAX_MEMORY_CONTENT_CHARS = 4000;

const CONTENT_SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[A-Za-z0-9_-]{12,}['"]?/i,
];

export interface WritePolicyCandidate {
  content: string;
  evidence: string | null;
  confidence: number;
}

export interface WritePolicyResult {
  allowed: boolean;
  reason: string | null;
}

export function evaluateWritePolicy(candidate: WritePolicyCandidate): WritePolicyResult {
  if (candidate.content.trim().length === 0) return { allowed: false, reason: 'empty content' };
  if (candidate.content.length > MAX_MEMORY_CONTENT_CHARS) return { allowed: false, reason: `content exceeds ${MAX_MEMORY_CONTENT_CHARS} characters` };
  if (!candidate.evidence || candidate.evidence.trim().length === 0) return { allowed: false, reason: 'no evidence provided' };
  if (candidate.confidence < 0 || candidate.confidence > 1) return { allowed: false, reason: 'confidence must be within [0, 1]' };
  for (const pattern of CONTENT_SECRET_PATTERNS) {
    if (pattern.test(candidate.content)) return { allowed: false, reason: 'content matches a secret-like pattern' };
  }
  return { allowed: true, reason: null };
}
