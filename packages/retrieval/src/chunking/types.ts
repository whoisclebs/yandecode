export interface Chunk {
  kind: string;
  symbol: string | null;
  startLine: number;
  endLine: number;
  content: string;
}

export interface ChunkLimits {
  targetTokens: number;
  maxTokens: number;
  overlapTokens: number;
}

export const DEFAULT_LIMITS: ChunkLimits = { targetTokens: 350, maxTokens: 450, overlapTokens: 50 };

export interface Chunker {
  chunk(path: string, content: string, language: string | null): Promise<Chunk[]>;
}
