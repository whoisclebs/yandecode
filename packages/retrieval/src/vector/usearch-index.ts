import { existsSync, renameSync } from 'node:fs';
import { Index, MetricKind, ScalarKind } from 'usearch';
import type { VectorHit, VectorIndex, VectorIndexStats, VectorRecord } from './types.js';

export interface USearchVectorIndexOptions {
  dimensions: number;
  file: string | null;
  connectivity?: number;
}

export class USearchVectorIndex implements VectorIndex {
  private index: Index;
  private readonly dims: number;
  private readonly file: string | null;
  private readonly connectivity: number;

  constructor(options: USearchVectorIndexOptions) {
    this.dims = options.dimensions;
    this.file = options.file;
    this.connectivity = options.connectivity ?? 16;
    this.index = this.newIndex();
  }

  private newIndex(): Index {
    return new Index({
      metric: MetricKind.Cos,
      dimensions: this.dims,
      connectivity: this.connectivity,
      quantization: ScalarKind.F32,
      expansion_add: 0,
      expansion_search: 0,
      multi: false,
    });
  }

  dimensions(): number {
    return this.dims;
  }

  add(id: number, vector: Float32Array): void {
    this.index.add(BigInt(id), vector);
  }

  remove(id: number): void {
    if (this.contains(id)) this.index.remove(BigInt(id));
  }

  contains(id: number): boolean {
    return this.index.contains(BigInt(id)) as boolean;
  }

  search(vector: Float32Array, limit: number): VectorHit[] {
    if (this.index.size() === 0) return [];
    const { keys, distances } = this.index.search(vector, limit, 0);
    const hits: VectorHit[] = [];
    for (let i = 0; i < keys.length; i += 1) {
      hits.push({ id: Number(keys[i]), score: 1 - (distances[i] as number) });
    }
    return hits;
  }

  save(): void {
    if (!this.file) throw new Error('USearchVectorIndex: cannot save without a file path');
    const tmp = `${this.file}.tmp`;
    this.index.save(tmp);
    renameSync(tmp, this.file);
  }

  load(): void {
    if (!this.file || !existsSync(this.file)) return;
    this.index = this.newIndex();
    this.index.load(this.file);
  }

  rebuild(records: Iterable<VectorRecord>): void {
    const fresh = this.newIndex();
    for (const record of records) fresh.add(BigInt(record.id), record.vector);
    if (this.file) {
      const building = `${this.file}.building`;
      fresh.save(building);
      renameSync(building, this.file);
    }
    this.index = fresh;
  }

  stats(): VectorIndexStats {
    return { size: this.index.size(), dimensions: this.dims, file: this.file };
  }
}
