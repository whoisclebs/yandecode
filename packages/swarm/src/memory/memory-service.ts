import { createHash } from 'node:crypto';
import type { MemoryNamespace, MemoryRecord, MemoryRepository } from '@yandecode/core';
import type { EmbeddingProvider, VectorIndex } from '@yandecode/retrieval';
import { evaluateWritePolicy } from './write-policy.js';

export const NEAR_DUPLICATE_THRESHOLD = 0.95;

export interface MemoryServiceDeps {
  memories: MemoryRepository;
  provider: EmbeddingProvider;
  index: VectorIndex;
}

export interface MemoryStoreInput {
  namespace: MemoryNamespace;
  content: string;
  summary: string | null;
  sourceSwarmId: string | null;
  sourceTaskId: string | null;
  confidence: number;
  evidence: string | null;
}

export type MemoryStoreResult =
  | { status: 'stored'; memory: MemoryRecord }
  | { status: 'rejected'; reason: string }
  | { status: 'duplicate'; existing: MemoryRecord };

export interface MemoryFeedbackInput {
  memoryId: string;
  taskId: string | null;
  verdict: 'helpful' | 'wrong' | 'stale';
  note: string | null;
}

function hashContent(namespace: MemoryNamespace, content: string): string {
  return createHash('sha256').update(`${namespace}:${content}`).digest('hex');
}

const FEEDBACK_CONFIDENCE_DELTA: Record<MemoryFeedbackInput['verdict'], number> = {
  helpful: 0.1,
  wrong: -0.3,
  stale: -0.05,
};

export class MemoryService {
  constructor(private readonly deps: MemoryServiceDeps) {}

  async store(input: MemoryStoreInput): Promise<MemoryStoreResult> {
    const policy = evaluateWritePolicy({ content: input.content, evidence: input.evidence, confidence: input.confidence });
    if (!policy.allowed) return { status: 'rejected', reason: policy.reason ?? 'rejected by write policy' };

    const contentHash = hashContent(input.namespace, input.content);
    const exact = this.deps.memories.findByContentHash(contentHash);
    if (exact) return { status: 'duplicate', existing: exact };

    const embedding = await this.deps.provider.embedDocument(input.content);
    const nearest = this.deps.index.search(embedding, 1)[0];
    if (nearest && nearest.score >= NEAR_DUPLICATE_THRESHOLD) {
      const existing = this.deps.memories.byVectorIds([nearest.id])[0];
      if (existing) return { status: 'duplicate', existing };
    }

    const memory = await this.deps.memories.create({
      namespace: input.namespace,
      content: input.content,
      summary: input.summary,
      sourceSwarmId: input.sourceSwarmId,
      sourceTaskId: input.sourceTaskId,
      confidence: input.confidence,
      contentHash,
      embedding,
    });
    this.deps.index.add(memory.vectorId, embedding);
    this.deps.index.save();
    return { status: 'stored', memory };
  }

  feedback(input: MemoryFeedbackInput): Promise<{ feedbackId: string }> {
    return this.deps.memories.applyFeedback({ ...input, confidenceDelta: FEEDBACK_CONFIDENCE_DELTA[input.verdict] });
  }
}
