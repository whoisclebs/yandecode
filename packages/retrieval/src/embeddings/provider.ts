export interface TokenCounter {
  countTokens(text: string): Promise<number>;
}

export interface EmbeddingProvider extends TokenCounter {
  readonly dimensions: number;
  readonly modelId: string;
  embedQuery(text: string): Promise<Float32Array>;
  embedDocument(text: string): Promise<Float32Array>;
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}

export class ApproxTokenCounter implements TokenCounter {
  countTokens(text: string): Promise<number> {
    return Promise.resolve(Math.ceil(text.length / 4));
  }
}
