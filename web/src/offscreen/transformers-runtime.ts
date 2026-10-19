// Transformers.js Runtime running in the Chrome MV3 offscreen document.
// Hosts Qwen 2.5 (Text) and SmolVLM (Multimodal) via ONNX Runtime Web.

import { pipeline, env } from '@huggingface/transformers';
import type { LocalModelDef, ChatMessage } from '../types';

export interface InitProgress {
  progress: number;
  text: string;
}

// Configure transformers.js for Chrome extension environment
env.allowRemoteModels = true;
env.allowLocalModels = true;

if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('dist/ort-wasm/');
  }
}

export class TransformersRuntime {
  private pipelineInstance: unknown = null;
  private currentModelId: string | null = null;
  private isInterrupted: boolean = false;

  async initialize(
    modelDef: LocalModelDef,
    onProgress: (p: InitProgress) => void,
    _abortSignal: AbortSignal
  ): Promise<void> {
    const config = modelDef.transformersConfig;
    const modelId = config?.modelId ?? 'onnx-community/Qwen2.5-0.5B-Instruct';
    const task = config?.task ?? 'text-generation';
    const dtype = config?.dtype ?? 'q4';

    if (this.pipelineInstance && this.currentModelId === modelId) {
      onProgress({ progress: 1.0, text: 'Model already loaded' });
      return;
    }

    if (this.pipelineInstance) {
      await this.unload();
    }

    this.currentModelId = modelId;
    this.isInterrupted = false;

    onProgress({ progress: 0.05, text: `Preparing ${modelDef.display}...` });

    let isWebGpu = false;
    const navGpu = typeof navigator !== 'undefined'
      ? (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu
      : undefined;
    if (navGpu?.requestAdapter) {
      try {
        const adapter = await navGpu.requestAdapter();
        isWebGpu = !!adapter;
      } catch {
        isWebGpu = false;
      }
    }

    if (!isWebGpu) {
      throw new Error('WebGPU is required for on-device models. On Linux, please enable "Unsafe WebGPU" in chrome://flags and relaunch your browser.');
    }
    const device = 'webgpu';

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const pipe = await pipeline(task as any, modelId, {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
      dtype: dtype as any,
      device,
      progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
        if (typeof info.progress === 'number') {
          const ratio = Math.min(1.0, Math.max(0.0, info.progress / 100));
          onProgress({
            progress: ratio,
            text: info.file ? `Downloading ${info.file} (${Math.round(info.progress)}%)` : `Loading weights (${Math.round(info.progress)}%)`,
          });
        }
      },
    });

    this.pipelineInstance = pipe;
    onProgress({ progress: 1.0, text: 'Model ready' });
  }

  async generate(
    messages: ChatMessage[],
    maxTokens: number,
    _params: Record<string, unknown>
  ): Promise<string> {
    if (!this.pipelineInstance) {
      throw new Error('Transformers.js pipeline is not loaded');
    }
    if (this.isInterrupted) {
      throw new Error('Inference was interrupted');
    }

    const pipe = this.pipelineInstance as (
      input: unknown,
      options?: Record<string, unknown>
    ) => Promise<Array<{ generated_text?: unknown }>>;

    // Convert messages format for Transformers.js text-generation
    const chatInput = messages.map(m => {
      let content = m.content;
      if (Array.isArray(content)) {
        // Multipart text + image
        content = content
          .map(part => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && 'text' in part) return (part as { text: string }).text;
            return '';
          })
          .join('\n');
      }
      return { role: m.role, content };
    });

    const response = (await pipe(chatInput, {
      max_new_tokens: maxTokens,
      temperature: 0.0,
      do_sample: false,
      return_full_text: false,
    })) as unknown;

    if (Array.isArray(response) && response.length > 0) {
      const first = response[0] as Record<string, unknown> | undefined;
      const generated = first?.generated_text;
      if (typeof generated === 'string') {
        return generated.trim();
      }
      if (Array.isArray(generated) && generated.length > 0) {
        const arr = generated as unknown[];
        const last = arr[arr.length - 1];
        if (last && typeof last === 'object' && 'content' in last) {
          const content = (last as { content?: unknown }).content;
          return typeof content === 'string' ? content.trim() : '';
        }
      }
    }

    return '';
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async interrupt(): Promise<void> {
    this.isInterrupted = true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async unload(): Promise<void> {
    this.pipelineInstance = null;
    this.currentModelId = null;
    this.isInterrupted = false;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async countTokens(text: string): Promise<number> {
    // Standard approximation: ~3.5 chars per token
    return Math.ceil(text.length / 3.5);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async truncateText(text: string, maxTokens: number): Promise<string> {
    const maxChars = Math.floor(maxTokens * 3.5);
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  }
}
