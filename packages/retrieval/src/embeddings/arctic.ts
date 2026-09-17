import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { userCacheDir } from '@yandecode/core';
import {
  AutoTokenizer,
  env as transformersEnv,
  pipeline,
  type FeatureExtractionPipeline,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';
import type { EmbeddingProvider } from './provider.js';

export const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
export const ARCTIC_MODEL_ID = 'Snowflake/snowflake-arctic-embed-xs';
export const ARCTIC_DIMENSIONS = 384;
const BATCH = 16;

// Mirrors the model files (content-identical, flattened path layout) so model
// download doesn't depend on a single external host being reachable. Override
// with YANDECODE_MODEL_HOST to point at the original Hugging Face Hub
// ("https://huggingface.co/", template "{model}/resolve/main/") or a private
// mirror.
export const DEFAULT_MODEL_HOST =
  'https://raw.githubusercontent.com/whoisclebs/yandecode-models/main/';
const DEFAULT_MODEL_PATH_TEMPLATE = '{model}/';

const HF_HOSTNAMES = new Set(['huggingface.co', 'hf.co']);

export function resolveModelHost(envVars: NodeJS.ProcessEnv = process.env): string {
  return envVars.YANDECODE_MODEL_HOST ?? DEFAULT_MODEL_HOST;
}

// The Hub needs a `resolve/{revision}/` segment; our flat mirror layout (and
// any other plain file host pointed at via YANDECODE_MODEL_HOST) doesn't.
export function resolveModelPathTemplate(host: string): string {
  try {
    if (HF_HOSTNAMES.has(new URL(host).hostname)) return '{model}/resolve/{revision}/';
  } catch {
    // Malformed host: fall through to the flat-layout default below.
  }
  return DEFAULT_MODEL_PATH_TEMPLATE;
}

export function resolveModelCacheDir(envVars: NodeJS.ProcessEnv = process.env): string {
  return envVars.YANDECODE_MODEL_DIR ?? join(userCacheDir(envVars), 'models');
}

export function modelIsCached(cacheDir: string, modelId: string = ARCTIC_MODEL_ID): boolean {
  return existsSync(join(cacheDir, modelId, 'onnx', 'model_quantized.onnx'));
}

export interface ArcticOptions {
  cacheDir: string;
  modelId?: string;
  idleTimeoutMs?: number;
}

export class ArcticEmbedXsProvider implements EmbeddingProvider {
  readonly dimensions = ARCTIC_DIMENSIONS;
  readonly modelId: string;
  private readonly cacheDir: string;
  private readonly idleTimeoutMs: number;
  private extractor: Promise<FeatureExtractionPipeline> | null = null;
  private tokenizer: Promise<PreTrainedTokenizer> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(options: ArcticOptions) {
    this.cacheDir = options.cacheDir;
    this.modelId = options.modelId ?? ARCTIC_MODEL_ID;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000;
    const host = resolveModelHost();
    transformersEnv.remoteHost = host;
    transformersEnv.remotePathTemplate = resolveModelPathTemplate(host);
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.dispose(), this.idleTimeoutMs);
    this.idleTimer.unref();
  }

  private getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractor) {
      this.extractor = pipeline('feature-extraction', this.modelId, {
        dtype: 'q8',
        cache_dir: this.cacheDir,
      });
    }
    this.touch();
    return this.extractor;
  }

  private getTokenizer(): Promise<PreTrainedTokenizer> {
    if (!this.tokenizer) {
      this.tokenizer = AutoTokenizer.from_pretrained(this.modelId, { cache_dir: this.cacheDir });
    }
    this.touch();
    return this.tokenizer;
  }

  private async run(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.getExtractor();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      const tensor = await extractor(batch, { pooling: 'cls', normalize: true });
      const data = tensor.data as Float32Array;
      for (let j = 0; j < batch.length; j++) {
        out.push(new Float32Array(data.subarray(j * this.dimensions, (j + 1) * this.dimensions)));
      }
      tensor.dispose();
    }
    return out;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [v] = await this.run([`${QUERY_PREFIX}${text}`]);
    return v!;
  }

  async embedDocument(text: string): Promise<Float32Array> {
    const [v] = await this.run([text]);
    return v!;
  }

  embedDocuments(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return Promise.resolve([]);
    return this.run(texts);
  }

  async countTokens(text: string): Promise<number> {
    const tokenizer = await this.getTokenizer();
    return tokenizer.encode(text).length;
  }

  async dispose(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const extractor = this.extractor;
    this.extractor = null;
    this.tokenizer = null;
    if (extractor) await (await extractor).dispose();
  }
}
