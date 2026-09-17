export interface VectorHit {
  id: number;
  score: number;
}

export interface VectorRecord {
  id: number;
  vector: Float32Array;
}

export interface VectorIndexStats {
  size: number;
  dimensions: number;
  file: string | null;
}

export interface VectorIndex {
  dimensions(): number;
  add(id: number, vector: Float32Array): void;
  remove(id: number): void;
  contains(id: number): boolean;
  search(vector: Float32Array, limit: number): VectorHit[];
  save(): void;
  load(): void;
  rebuild(records: Iterable<VectorRecord>): void;
  stats(): VectorIndexStats;
}
