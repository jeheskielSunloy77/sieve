// Transformers.js LocalBackend proxy.
// Manages the offscreen document lifecycle and routes calls to TransformersRuntime.

import type { LocalModelDef, ChatMessage } from '../../types';
import type { LocalBackend, InitProgress } from './types';

const OFFSCREEN_URL = 'offscreen.html';
let nextRequestId = 1;

const progressListeners = new Map<number, (p: InitProgress) => void>();

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message: unknown) => {
    const m = message as { channel?: string; id?: number; progress?: number; text?: string };
    if (m?.channel !== 'transformers-progress') return false;
    if (typeof m.id !== 'number') return false;
    const cb = progressListeners.get(m.id);
    if (cb && typeof m.progress === 'number') {
      cb({ progress: m.progress, text: m.text ?? '' });
    }
    return false;
  });
}

async function ensureOffscreen(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.offscreen) return;

  const offscreenApi = chrome.offscreen as unknown as {
    hasDocument?: () => Promise<boolean>;
    createDocument: (opts: { url: string; reasons: string[]; justification: string }) => Promise<void>;
  };

  if (typeof offscreenApi.hasDocument === 'function') {
    if (await offscreenApi.hasDocument()) return;
  } else if (typeof self !== 'undefined' && 'clients' in self) {
    const matched = await (self as unknown as { clients: { matchAll: (opts: { includeUncontrolled: boolean }) => Promise<{ url: string }[]> } })
      .clients.matchAll({ includeUncontrolled: true });
    const target = chrome.runtime.getURL(OFFSCREEN_URL);
    if (matched.some(c => c.url === target)) return;
  }

  try {
    await offscreenApi.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['WORKERS'],
      justification: 'Run Transformers.js on-device inference.',
    });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? '';
    if (!msg.includes('Only a single offscreen document may be created')) {
      throw err;
    }
  }
}

interface OffscreenResponse<T = unknown> {
  ok: boolean;
  value?: T;
  error?: string;
}

async function sendToTransformers<T>(payload: Record<string, unknown>): Promise<T> {
  await ensureOffscreen();
  const id = nextRequestId++;
  const resp = await chrome.runtime.sendMessage<unknown, OffscreenResponse<T>>({
    target: 'sieve-transformers-offscreen',
    id,
    ...payload,
  });
  if (!resp?.ok) throw new Error(resp?.error ?? 'Transformers.js request failed');
  return resp.value as T;
}

export class TransformersBackend implements LocalBackend {
  async initialize(
    modelDef: LocalModelDef,
    onProgress: (p: InitProgress) => void,
    _abortSignal: AbortSignal
  ): Promise<void> {
    await ensureOffscreen();
    const id = nextRequestId++;
    progressListeners.set(id, onProgress);
    try {
      const resp = await chrome.runtime.sendMessage<unknown, OffscreenResponse<void>>({
        target: 'sieve-transformers-offscreen',
        id,
        method: 'init',
        modelDef,
      });
      if (!resp?.ok) throw new Error(resp?.error ?? 'Failed to initialize Transformers.js model');
    } finally {
      progressListeners.delete(id);
    }
  }

  async unload(): Promise<void> {
    await sendToTransformers({ method: 'unload' }).catch(() => { /* ignore */ });
  }

  async generate(
    messages: ChatMessage[],
    maxTokens: number,
    params: Record<string, unknown>
  ): Promise<string> {
    return await sendToTransformers<string>({
      method: 'generate',
      messages,
      maxTokens,
      params,
    });
  }

  async interrupt(): Promise<void> {
    await sendToTransformers({ method: 'interrupt' }).catch(() => { /* ignore */ });
  }

  async countTokens(text: string): Promise<number> {
    return await sendToTransformers<number>({
      method: 'countTokens',
      text,
    });
  }

  async truncateText(text: string, maxTokens: number): Promise<string> {
    return await sendToTransformers<string>({
      method: 'truncateText',
      text,
      maxTokens,
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getImageEmbedSize(): Promise<number> {
    return 0;
  }
}

// Check if model files exist in browser Cache Storage ('transformers-cache')
export async function isTransformersCached(modelDef: LocalModelDef): Promise<boolean> {
  const modelId = modelDef.transformersConfig?.modelId;
  if (!modelId) return false;
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open('transformers-cache');
    const match = await cache.match(`https://huggingface.co/${modelId}/resolve/main/config.json`);
    return !!match;
  } catch {
    return false;
  }
}
