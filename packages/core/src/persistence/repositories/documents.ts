import { newId, nowIso } from '../../ids.js';
import { toFtsQuery } from '../fts-query.js';
import type { StateService } from '../state-service.js';
import { blobToVector, vectorToBlob } from '../vectors.js';

export interface DocumentInput {
  path: string;
  language: string | null;
  sizeBytes: number;
  contentHash: string;
  gitCommit: string | null;
  indexGeneration: number;
}

export interface ChunkInput {
  kind: string;
  symbol: string | null;
  identifiers: string;
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  embedding: Float32Array | null;
}

export interface ChunkRecord {
  id: string;
  documentId: string;
  path: string;
  vectorId: number;
  kind: string;
  symbol: string | null;
  identifiers: string;
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
  tokenCount: number;
}

interface ChunkRow {
  id: string;
  document_id: string;
  path: string;
  vector_id: number;
  kind: string;
  symbol: string | null;
  identifiers: string;
  start_line: number;
  end_line: number;
  content: string;
  content_hash: string;
  token_count: number;
}

const CHUNK_SELECT = `SELECT c.id, c.document_id, d.path, c.vector_id, c.kind, c.symbol, c.identifiers, c.start_line, c.end_line,
  c.content, c.content_hash, c.token_count FROM chunks c JOIN documents d ON d.id = c.document_id`;

const fromRow = (r: ChunkRow): ChunkRecord => ({
  id: r.id,
  documentId: r.document_id,
  path: r.path,
  vectorId: r.vector_id,
  kind: r.kind,
  symbol: r.symbol,
  identifiers: r.identifiers,
  startLine: r.start_line,
  endLine: r.end_line,
  content: r.content,
  contentHash: r.content_hash,
  tokenCount: r.token_count,
});

export class DocumentRepository {
  constructor(private readonly state: StateService) {}

  listDocuments(): { id: string; path: string; contentHash: string }[] {
    const rows = this.state.read((db) =>
      db.prepare('SELECT id, path, content_hash FROM documents ORDER BY path').all(),
    ) as {
      id: string;
      path: string;
      content_hash: string;
    }[];
    return rows.map((r) => ({ id: r.id, path: r.path, contentHash: r.content_hash }));
  }

  replaceDocument(
    doc: DocumentInput,
    chunks: ChunkInput[],
  ): Promise<{ documentId: string; inserted: ChunkRecord[]; removedVectorIds: number[] }> {
    return this.state.write((db) => {
      const removedVectorIds = (
        db
          .prepare(
            'SELECT c.vector_id AS v FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.path = ?',
          )
          .all(doc.path) as { v: number }[]
      ).map((r) => r.v);
      db.prepare('DELETE FROM documents WHERE path = ?').run(doc.path);
      const documentId = newId();
      const now = nowIso();
      db.prepare(
        'INSERT INTO documents (id, path, language, size_bytes, content_hash, git_commit, indexed_at, index_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        documentId,
        doc.path,
        doc.language,
        doc.sizeBytes,
        doc.contentHash,
        doc.gitCommit,
        now,
        doc.indexGeneration,
      );
      const seq = db
        .prepare(
          "UPDATE vector_id_seq SET next_id = next_id + ? WHERE name = 'repository' RETURNING next_id",
        )
        .get(chunks.length) as { next_id: number };
      let vectorId = seq.next_id - chunks.length;
      const insert = db.prepare(
        `INSERT INTO chunks (id, document_id, vector_id, kind, symbol, identifiers, start_line, end_line, content, content_hash, token_count, embedding, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const inserted: ChunkRecord[] = [];
      for (const c of chunks) {
        const id = newId();
        insert.run(
          id,
          documentId,
          vectorId,
          c.kind,
          c.symbol,
          c.identifiers,
          c.startLine,
          c.endLine,
          c.content,
          c.contentHash,
          c.tokenCount,
          c.embedding ? vectorToBlob(c.embedding) : null,
          now,
          now,
        );
        inserted.push({
          id,
          documentId,
          path: doc.path,
          vectorId,
          kind: c.kind,
          symbol: c.symbol,
          identifiers: c.identifiers,
          startLine: c.startLine,
          endLine: c.endLine,
          content: c.content,
          contentHash: c.contentHash,
          tokenCount: c.tokenCount,
        });
        vectorId += 1;
      }
      return { documentId, inserted, removedVectorIds };
    });
  }

  deleteDocument(path: string): Promise<number[]> {
    return this.state.write((db) => {
      const ids = (
        db
          .prepare(
            'SELECT c.vector_id AS v FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.path = ?',
          )
          .all(path) as { v: number }[]
      ).map((r) => r.v);
      db.prepare('DELETE FROM documents WHERE path = ?').run(path);
      return ids;
    });
  }

  chunksByVectorIds(ids: number[]): ChunkRecord[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.state.read((db) =>
      db.prepare(`${CHUNK_SELECT} WHERE c.vector_id IN (${placeholders})`).all(...ids),
    ) as ChunkRow[];
    const byId = new Map(rows.map((r) => [r.vector_id, fromRow(r)]));
    return ids.map((id) => byId.get(id)).filter((r): r is ChunkRecord => r !== undefined);
  }

  embeddingsByVectorIds(ids: number[]): Map<number, Float32Array> {
    const out = new Map<number, Float32Array>();
    if (ids.length === 0) return out;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.state.read((db) =>
      db
        .prepare(
          `SELECT vector_id, embedding FROM chunks WHERE vector_id IN (${placeholders}) AND embedding IS NOT NULL`,
        )
        .all(...ids),
    ) as { vector_id: number; embedding: Buffer }[];
    for (const r of rows) out.set(r.vector_id, blobToVector(r.embedding));
    return out;
  }

  *iterateEmbeddings(): IterableIterator<{ vectorId: number; embedding: Float32Array }> {
    const stmt = this.state.db.prepare(
      'SELECT vector_id, embedding FROM chunks WHERE embedding IS NOT NULL ORDER BY vector_id',
    );
    for (const row of stmt.iterate() as IterableIterator<{
      vector_id: number;
      embedding: Buffer;
    }>) {
      yield { vectorId: row.vector_id, embedding: blobToVector(row.embedding) };
    }
  }

  searchLexical(query: string, limit: number): { vectorId: number; score: number }[] {
    const fts = toFtsQuery(query);
    if (!fts) return [];
    const rows = this.state.read((db) =>
      db
        .prepare(
          `SELECT c.vector_id AS v, -bm25(chunks_fts, 1.0, 2.0, 1.5) AS s FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid
           WHERE chunks_fts MATCH ? ORDER BY s DESC LIMIT ?`,
        )
        .all(fts, limit),
    ) as { v: number; s: number }[];
    return rows.map((r) => ({ vectorId: r.v, score: r.s }));
  }

  counts(): { documents: number; chunks: number } {
    return this.state.read((db) => {
      const d = db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number };
      const c = db.prepare('SELECT COUNT(*) AS c FROM chunks').get() as { c: number };
      return { documents: d.c, chunks: c.c };
    });
  }

  allVectorIds(): number[] {
    return (
      this.state.read((db) =>
        db.prepare('SELECT vector_id AS v FROM chunks ORDER BY vector_id').all(),
      ) as { v: number }[]
    ).map((r) => r.v);
  }
}
