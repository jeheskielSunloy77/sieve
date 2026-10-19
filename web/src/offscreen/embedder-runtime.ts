// Stage 1 Embedder Runtime running in the Chrome MV3 offscreen document.
// Uses @huggingface/transformers with the bundled all-MiniLM-L6-v2 ONNX model
// to compute cosine similarity between post text and user filter phrases.

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

const BUNDLED_MODEL_NAME = 'all-MiniLM-L6-v2';
const DEFAULT_SIMILARITY_THRESHOLD = 0.08;

// Allow remote models for downloadable models (Qwen, SmolVLM) while enabling local models
env.allowRemoteModels = true;
env.allowLocalModels = true;

// Resolve paths inside the extension bundle
if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  env.localModelPath = chrome.runtime.getURL('dist/models');
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('dist/ort-wasm/');
  }
}

export interface EmbedderEvaluationResult {
  isMatch: boolean;
  maxSimilarity: number;
  topPhrase?: string;
  reason?: string;
}

export class EmbedderRuntime {
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
  // Cache normalized vectors for active filter phrases to avoid re-embedding on every post
  private topicVectorCache = new Map<string, Float32Array>();

  private async getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      let isWebGpuSupported = false;
      const navGpu = typeof navigator !== 'undefined'
        ? (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu
        : undefined;
      if (navGpu?.requestAdapter) {
        try {
          const adapter = await navGpu.requestAdapter();
          isWebGpuSupported = !!adapter;
        } catch {
          isWebGpuSupported = false;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opts: any = {
        device: isWebGpuSupported ? 'webgpu' : 'wasm',
        local_files_only: true,
        dtype: 'fp32',
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      this.pipelinePromise = pipeline('feature-extraction', BUNDLED_MODEL_NAME, opts);
    }
    return this.pipelinePromise;
  }

  private dotProduct(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  private async embedText(text: string): Promise<Float32Array> {
    const pipe = await this.getPipeline();
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    // output.data is Float32Array or numeric array
    return output.data instanceof Float32Array
      ? output.data
      : new Float32Array(output.data as unknown as ArrayLike<number>);
  }

  /**
   * Pre-embed and cache filter phrases.
   */
  async cacheFilterPhrases(phrases: string[]): Promise<void> {
    for (const phrase of phrases) {
      const trimmed = phrase.trim().toLowerCase();
      if (!trimmed || this.topicVectorCache.has(trimmed)) continue;
      try {
        const vec = await this.embedText(`This post is about ${trimmed}`);
        this.topicVectorCache.set(trimmed, vec);
      } catch (err) {
        console.warn(`[EmbedderRuntime] Failed to pre-embed phrase "${phrase}":`, err);
      }
    }
  }

  /**
   * Evaluate whether post text has sufficient semantic similarity or lexical overlap
   * with any of the user's filter phrases.
   */
  async evaluateSimilarity(
    postText: string,
    filterPhrases: string[],
    threshold: number = DEFAULT_SIMILARITY_THRESHOLD
  ): Promise<EmbedderEvaluationResult> {
    if (!filterPhrases || filterPhrases.length === 0) {
      return { isMatch: true, maxSimilarity: 1.0, reason: 'No filter phrases provided' };
    }

    const trimmedPost = postText.trim();
    if (!trimmedPost) {
      return { isMatch: false, maxSimilarity: -1.0, reason: 'Empty post text' };
    }

    const lowerPost = trimmedPost.toLowerCase();

    // 1. Fast lexical short-circuit: if a filter phrase appears verbatim, pass to Stage 2 immediately
    for (const phrase of filterPhrases) {
      const lowerPhrase = phrase.trim().toLowerCase();
      if (lowerPhrase.length > 2 && lowerPost.includes(lowerPhrase)) {
        return {
          isMatch: true,
          maxSimilarity: 1.0,
          topPhrase: phrase,
          reason: `Lexical keyword match: "${phrase}"`,
        };
      }
    }

    // 2. Semantic embedding check
    try {
      await this.cacheFilterPhrases(filterPhrases);
      const postVec = await this.embedText(trimmedPost);

      let maxSim = -1.0;
      let topPhrase: string | undefined;

      for (const phrase of filterPhrases) {
        const key = phrase.trim().toLowerCase();
        const topicVec = this.topicVectorCache.get(key);
        if (!topicVec) continue;

        const sim = this.dotProduct(postVec, topicVec);
        if (sim > maxSim) {
          maxSim = sim;
          topPhrase = phrase;
        }
      }

      const isMatch = maxSim >= threshold;
      return {
        isMatch,
        maxSimilarity: maxSim,
        topPhrase,
        reason: isMatch
          ? `Semantic similarity ${maxSim.toFixed(3)} >= ${threshold}`
          : `Semantic similarity ${maxSim.toFixed(3)} < ${threshold}`,
      };
    } catch (err) {
      // Graceful fail-open: if embedding fails, consider it a match so Stage 2 runs
      console.warn('[EmbedderRuntime] Error during embedding similarity evaluation, failing open:', err);
      return {
        isMatch: true,
        maxSimilarity: 1.0,
        reason: `Embedder error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  clearCache(): void {
    this.topicVectorCache.clear();
  }
}
