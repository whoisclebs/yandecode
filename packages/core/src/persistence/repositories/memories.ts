import { newId, nowIso } from '../../ids.js';
import { toFtsQuery } from '../fts-query.js';
import type { StateService } from '../state-service.js';
import { blobToVector, vectorToBlob } from '../vectors.js';

export type MemoryNamespace =
  'decisions' | 'patterns' | 'solutions' | 'failures' | 'tasks' | 'feedback';

export interface MemoryInput {
  namespace: MemoryNamespace;
  content: string;
  summary: string | null;
  evidence: string | null;
  sourceSwarmId: string | null;
  sourceTaskId: string | null;
  confidence: number;
  contentHash: string;
  embedding: Float32Array;
}

export interface MemoryRecord {
  id: string;
  namespace: MemoryNamespace;
  content: string;
  summary: string | null;
  evidence: string | null;
  sourceSwarmId: string | null;
  sourceTaskId: string | null;
  confidence: number;
  usageCount: number;
  successCount: number;
  failureCount: number;
  vectorId: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  archivedAt: string | null;
}

interface MemoryRow {
  id: string;
  namespace: MemoryNamespace;
  content: string;
  summary: string | null;
  evidence: string | null;
  source_swarm_id: string | null;
  source_task_id: string | null;
  confidence: number;
  usage_count: number;
  success_count: number;
  failure_count: number;
  vector_id: number;
  content_hash: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  archived_at: string | null;
}

const MEMORY_SELECT =
  'SELECT id, namespace, content, summary, evidence, source_swarm_id, source_task_id, confidence, usage_count, success_count, failure_count, vector_id, content_hash, created_at, updated_at, last_used_at, archived_at FROM memories';

const fromRow = (r: MemoryRow): MemoryRecord => ({
  id: r.id,
  namespace: r.namespace,
  content: r.content,
  summary: r.summary,
  evidence: r.evidence,
  sourceSwarmId: r.source_swarm_id,
  sourceTaskId: r.source_task_id,
  confidence: r.confidence,
  usageCount: r.usage_count,
  successCount: r.success_count,
  failureCount: r.failure_count,
  vectorId: r.vector_id,
  contentHash: r.content_hash,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastUsedAt: r.last_used_at,
  archivedAt: r.archived_at,
});

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class MemoryRepository {
  constructor(private readonly state: StateService) {}

  create(input: MemoryInput): Promise<MemoryRecord> {
    return this.state.write((db) => {
      const seq = db
        .prepare(
          "UPDATE vector_id_seq SET next_id = next_id + 1 WHERE name = 'memory' RETURNING next_id",
        )
        .get() as { next_id: number };
      const vectorId = seq.next_id - 1;
      const id = newId();
      const now = nowIso();
      db.prepare(
        `INSERT INTO memories (id, namespace, content, summary, evidence, source_swarm_id, source_task_id, confidence, usage_count, success_count, failure_count, vector_id, content_hash, embedding, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.namespace,
        input.content,
        input.summary,
        input.evidence,
        input.sourceSwarmId,
        input.sourceTaskId,
        input.confidence,
        vectorId,
        input.contentHash,
        vectorToBlob(input.embedding),
        now,
        now,
      );
      return {
        id,
        namespace: input.namespace,
        content: input.content,
        summary: input.summary,
        evidence: input.evidence,
        sourceSwarmId: input.sourceSwarmId,
        sourceTaskId: input.sourceTaskId,
        confidence: input.confidence,
        usageCount: 0,
        successCount: 0,
        failureCount: 0,
        vectorId,
        contentHash: input.contentHash,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
        archivedAt: null,
      };
    });
  }

  get(id: string): MemoryRecord | null {
    const row = this.state.read((db) => db.prepare(`${MEMORY_SELECT} WHERE id = ?`).get(id)) as
      MemoryRow | undefined;
    return row ? fromRow(row) : null;
  }

  findByContentHash(hash: string): MemoryRecord | null {
    const row = this.state.read((db) =>
      db.prepare(`${MEMORY_SELECT} WHERE content_hash = ?`).get(hash),
    ) as MemoryRow | undefined;
    return row ? fromRow(row) : null;
  }

  byVectorIds(ids: number[]): MemoryRecord[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.state.read((db) =>
      db.prepare(`${MEMORY_SELECT} WHERE vector_id IN (${placeholders})`).all(...ids),
    ) as MemoryRow[];
    const byId = new Map(rows.map((r) => [r.vector_id, fromRow(r)]));
    return ids.map((id) => byId.get(id)).filter((r): r is MemoryRecord => r !== undefined);
  }

  embeddingsByVectorIds(ids: number[]): Map<number, Float32Array> {
    const out = new Map<number, Float32Array>();
    if (ids.length === 0) return out;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.state.read((db) =>
      db
        .prepare(`SELECT vector_id, embedding FROM memories WHERE vector_id IN (${placeholders})`)
        .all(...ids),
    ) as { vector_id: number; embedding: Buffer }[];
    for (const r of rows) out.set(r.vector_id, blobToVector(r.embedding));
    return out;
  }

  *iterateEmbeddings(): IterableIterator<{ vectorId: number; embedding: Float32Array }> {
    const stmt = this.state.db.prepare(
      'SELECT vector_id, embedding FROM memories ORDER BY vector_id',
    );
    for (const row of stmt.iterate() as IterableIterator<{
      vector_id: number;
      embedding: Buffer;
    }>) {
      yield { vectorId: row.vector_id, embedding: blobToVector(row.embedding) };
    }
  }

  count(): number {
    return this.state.read(
      (db) => (db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n,
    );
  }

  searchLexical(
    query: string,
    namespace: MemoryNamespace | null,
    limit: number,
  ): { vectorId: number; score: number }[] {
    const fts = toFtsQuery(query);
    if (!fts) return [];
    const rows = this.state.read((db) =>
      db
        .prepare(
          `SELECT m.vector_id AS v, -bm25(memories_fts, 1.0, 2.0) AS s FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
           WHERE memories_fts MATCH ? AND m.archived_at IS NULL AND (? IS NULL OR m.namespace = ?) ORDER BY s DESC LIMIT ?`,
        )
        .all(fts, namespace, namespace, limit),
    ) as { v: number; s: number }[];
    return rows.map((r) => ({ vectorId: r.v, score: r.s }));
  }

  recordUsage(id: string, outcome: 'success' | 'failure'): Promise<void> {
    return this.state.write((db) => {
      const now = nowIso();
      const column = outcome === 'success' ? 'success_count' : 'failure_count';
      db.prepare(
        `UPDATE memories SET usage_count = usage_count + 1, ${column} = ${column} + 1, last_used_at = ?, updated_at = ? WHERE id = ?`,
      ).run(now, now, id);
    });
  }

  applyFeedback(input: {
    memoryId: string;
    taskId: string | null;
    verdict: 'helpful' | 'wrong' | 'stale';
    note: string | null;
    confidenceDelta: number;
  }): Promise<{ feedbackId: string }> {
    return this.state.write((db) => {
      const now = nowIso();
      const feedbackId = newId();
      db.prepare(
        'INSERT INTO memory_feedback (id, memory_id, task_id, verdict, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(feedbackId, input.memoryId, input.taskId, input.verdict, input.note, now);
      const current = db
        .prepare('SELECT confidence FROM memories WHERE id = ?')
        .get(input.memoryId) as { confidence: number } | undefined;
      if (current) {
        const nextConfidence = clamp01(current.confidence + input.confidenceDelta);
        const column =
          input.verdict === 'helpful'
            ? 'success_count'
            : input.verdict === 'wrong'
              ? 'failure_count'
              : null;
        if (column) {
          db.prepare(
            `UPDATE memories SET confidence = ?, ${column} = ${column} + 1, updated_at = ? WHERE id = ?`,
          ).run(nextConfidence, now, input.memoryId);
        } else {
          db.prepare('UPDATE memories SET confidence = ?, updated_at = ? WHERE id = ?').run(
            nextConfidence,
            now,
            input.memoryId,
          );
        }
      }
      return { feedbackId };
    });
  }
}
