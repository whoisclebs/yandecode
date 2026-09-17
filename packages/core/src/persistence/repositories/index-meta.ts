import { nowIso } from '../../ids.js';
import type { StateService } from '../state-service.js';

export type IndexName = 'repository' | 'memory';

export interface VectorIndexMeta {
  name: IndexName;
  generation: number;
  dimensions: number;
  modelId: string;
  vectorCount: number;
  builtAt: string;
  filePath: string;
}

export interface DirtyEntry {
  path: string;
  reason: string;
  markedAt: string;
}

interface MetaRow {
  name: IndexName;
  generation: number;
  dimensions: number;
  model_id: string;
  vector_count: number;
  built_at: string;
  file_path: string;
}

export class IndexRepository {
  constructor(private readonly state: StateService) {}

  getMeta(name: IndexName): VectorIndexMeta | null {
    const r = this.state.read((db) => db.prepare('SELECT * FROM vector_index_meta WHERE name = ?').get(name)) as MetaRow | undefined;
    if (!r) return null;
    return {
      name: r.name,
      generation: r.generation,
      dimensions: r.dimensions,
      modelId: r.model_id,
      vectorCount: r.vector_count,
      builtAt: r.built_at,
      filePath: r.file_path,
    };
  }

  setMeta(meta: VectorIndexMeta): Promise<void> {
    return this.state.write((db) => {
      db.prepare(
        `INSERT INTO vector_index_meta (name, generation, dimensions, model_id, vector_count, built_at, file_path)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET generation=excluded.generation, dimensions=excluded.dimensions,
           model_id=excluded.model_id, vector_count=excluded.vector_count, built_at=excluded.built_at, file_path=excluded.file_path`,
      ).run(meta.name, meta.generation, meta.dimensions, meta.modelId, meta.vectorCount, meta.builtAt, meta.filePath);
    });
  }

  markDirty(path: string, reason: string): Promise<void> {
    return this.state.write((db) => {
      db.prepare(
        'INSERT INTO index_dirty (path, reason, marked_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET reason=excluded.reason, marked_at=excluded.marked_at',
      ).run(path, reason, nowIso());
    });
  }

  listDirty(): DirtyEntry[] {
    const rows = this.state.read((db) => db.prepare('SELECT path, reason, marked_at FROM index_dirty ORDER BY path').all()) as {
      path: string;
      reason: string;
      marked_at: string;
    }[];
    return rows.map((r) => ({ path: r.path, reason: r.reason, markedAt: r.marked_at }));
  }

  clearDirty(paths: string[]): Promise<void> {
    return this.state.write((db) => {
      const del = db.prepare('DELETE FROM index_dirty WHERE path = ?');
      for (const p of paths) del.run(p);
    });
  }

  counts(): { documents: number; chunks: number } {
    return this.state.read((db) => {
      const d = db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number };
      const c = db.prepare('SELECT COUNT(*) AS c FROM chunks').get() as { c: number };
      return { documents: d.c, chunks: c.c };
    });
  }
}
