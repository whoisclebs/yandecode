import { describe, expect, it } from 'vitest';
import { evaluateWritePolicy, MAX_MEMORY_CONTENT_CHARS } from '../src/memory/write-policy.js';

describe('evaluateWritePolicy', () => {
  it('allows valid content with evidence and in-range confidence', () => {
    const result = evaluateWritePolicy({ content: 'Retry idle DB connections with exponential backoff.', evidence: 'task-123', confidence: 0.7 });
    expect(result).toEqual({ allowed: true, reason: null });
  });

  it('rejects empty or whitespace-only content', () => {
    expect(evaluateWritePolicy({ content: '   ', evidence: 'task-123', confidence: 0.5 }).allowed).toBe(false);
  });

  it('rejects content over the size cap', () => {
    const result = evaluateWritePolicy({ content: 'x'.repeat(MAX_MEMORY_CONTENT_CHARS + 1), evidence: 'task-123', confidence: 0.5 });
    expect(result).toEqual({ allowed: false, reason: `content exceeds ${MAX_MEMORY_CONTENT_CHARS} characters` });
  });

  it('rejects content with no evidence', () => {
    expect(evaluateWritePolicy({ content: 'a useful fact', evidence: null, confidence: 0.5 }).allowed).toBe(false);
    expect(evaluateWritePolicy({ content: 'a useful fact', evidence: '   ', confidence: 0.5 }).allowed).toBe(false);
  });

  it('rejects confidence outside [0, 1]', () => {
    expect(evaluateWritePolicy({ content: 'a useful fact', evidence: 'task-1', confidence: 1.1 }).allowed).toBe(false);
    expect(evaluateWritePolicy({ content: 'a useful fact', evidence: 'task-1', confidence: -0.1 }).allowed).toBe(false);
  });

  it('rejects content containing a PEM private key header', () => {
    const result = evaluateWritePolicy({ content: '-----BEGIN RSA PRIVATE KEY-----\nMIIExyz\n-----END RSA PRIVATE KEY-----', evidence: 'task-1', confidence: 0.5 });
    expect(result).toEqual({ allowed: false, reason: 'content matches a secret-like pattern' });
  });

  it('rejects content containing an AWS access key id', () => {
    const result = evaluateWritePolicy({ content: 'the key was AKIAABCDEFGHIJKLMNOP embedded in config', evidence: 'task-1', confidence: 0.5 });
    expect(result.allowed).toBe(false);
  });

  it('rejects content containing an inline api_key/token/password assignment', () => {
    expect(evaluateWritePolicy({ content: 'api_key: "sk-ab12cd34ef56gh78ij90"', evidence: 'task-1', confidence: 0.5 }).allowed).toBe(false);
    expect(evaluateWritePolicy({ content: 'password = "hunter2hunter2hunter2"', evidence: 'task-1', confidence: 0.5 }).allowed).toBe(false);
  });

  it('rejects content containing a SECRET_KEY-style assignment', () => {
    expect(evaluateWritePolicy({ content: 'SECRET_KEY = "abcdefghijklmnop123"', evidence: 'task-1', confidence: 0.5 }).allowed).toBe(false);
    expect(evaluateWritePolicy({ content: 'secret_key: "wJalrXUtnFEMIK7MDENGbPxRfiCY"', evidence: 'task-1', confidence: 0.5 }).allowed).toBe(false);
  });

  it('rejects content containing an AWS temporary session credential (ASIA prefix)', () => {
    const result = evaluateWritePolicy({ content: 'the token was ASIAABCDEFGHIJKLMNOP in the logs', evidence: 'task-1', confidence: 0.5 });
    expect(result.allowed).toBe(false);
  });
});
