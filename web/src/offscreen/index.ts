// Entry point for the Chrome offscreen document. Bridges chrome.runtime
// messages from the service worker to on-device runtimes:
// 1. LitertlmRuntime (existing LiteRT-LM Gemma runtime)
// 2. EmbedderRuntime (Stage 1 bundled all-MiniLM-L6-v2 pre-filter)
// 3. TransformersRuntime (Qwen 2.5 Text & SmolVLM Vision via ONNX Runtime Web)
// 4. ChromeAiRuntime (Chrome Built-in AI / Gemini Nano)

import { LitertlmRuntime } from './litertlm-runtime';
import { EmbedderRuntime } from './embedder-runtime';
import { TransformersRuntime } from './transformers-runtime';
import { ChromeAiRuntime } from './chrome-ai-runtime';
import type { LocalModelDef, ChatMessage } from '../types';

interface InitProgressUpdate {
  channel: 'litertlm-progress' | 'transformers-progress';
  id: number;
  progress: number;
  text: string;
}

interface BaseRequest { id: number }

// --- LiteRT-LM requests ---
interface LitertlmRequest extends BaseRequest {
  target: 'litertlm-offscreen';
  method: 'init' | 'cancelInit' | 'generate' | 'interrupt' | 'unload' | 'countTokens' | 'truncateText';
  modelDef?: LocalModelDef;
  messages?: ChatMessage[];
  maxTokens?: number;
  params?: Record<string, unknown>;
  text?: string;
}

// --- Embedder requests ---
interface EmbedderRequest extends BaseRequest {
  target: 'sieve-embedder-offscreen';
  method: 'evaluateSimilarity' | 'cachePhrases';
  postText?: string;
  filterPhrases?: string[];
  threshold?: number;
}

// --- Transformers requests ---
interface TransformersRequest extends BaseRequest {
  target: 'sieve-transformers-offscreen';
  method: 'init' | 'generate' | 'interrupt' | 'unload' | 'countTokens' | 'truncateText';
  modelDef?: LocalModelDef;
  messages?: ChatMessage[];
  maxTokens?: number;
  params?: Record<string, unknown>;
  text?: string;
}

// --- Chrome Built-in AI requests ---
interface ChromeAiRequest extends BaseRequest {
  target: 'sieve-chrome-ai-offscreen';
  method: 'checkCapabilities' | 'init' | 'generate' | 'unload';
  systemPrompt?: string;
  userPrompt?: string;
}

type SieveOffscreenRequest = LitertlmRequest | EmbedderRequest | TransformersRequest | ChromeAiRequest;

const litertlmRuntime = new LitertlmRuntime();
const embedderRuntime = new EmbedderRuntime();
const transformersRuntime = new TransformersRuntime();
const chromeAiRuntime = new ChromeAiRuntime();

let litertlmInitAbort: AbortController | null = null;
let transformersInitAbort: AbortController | null = null;

async function handleLitertlm(req: LitertlmRequest): Promise<unknown> {
  switch (req.method) {
    case 'init': {
      litertlmInitAbort = new AbortController();
      try {
        await litertlmRuntime.initialize(req.modelDef!, (p) => {
          const msg: InitProgressUpdate = {
            channel: 'litertlm-progress',
            id: req.id,
            progress: p.progress,
            text: p.text,
          };
          chrome.runtime.sendMessage(msg).catch(() => { /* SW may be idle */ });
        }, litertlmInitAbort.signal);
        return { ok: true };
      } finally {
        litertlmInitAbort = null;
      }
    }
    case 'cancelInit':
      litertlmInitAbort?.abort();
      return { ok: true };
    case 'generate':
      return { ok: true, value: await litertlmRuntime.generate(req.messages!, req.maxTokens!, req.params!) };
    case 'interrupt':
      await litertlmRuntime.interrupt();
      return { ok: true };
    case 'unload':
      await litertlmRuntime.unload();
      return { ok: true };
    case 'countTokens':
      return { ok: true, value: await litertlmRuntime.countTokens(req.text!) };
    case 'truncateText':
      return { ok: true, value: await litertlmRuntime.truncateText(req.text!, req.maxTokens!) };
  }
}

async function handleEmbedder(req: EmbedderRequest): Promise<unknown> {
  switch (req.method) {
    case 'evaluateSimilarity': {
      const result = await embedderRuntime.evaluateSimilarity(
        req.postText ?? '',
        req.filterPhrases ?? [],
        req.threshold
      );
      return { ok: true, value: result };
    }
    case 'cachePhrases':
      await embedderRuntime.cacheFilterPhrases(req.filterPhrases ?? []);
      return { ok: true };
  }
}

async function handleTransformers(req: TransformersRequest): Promise<unknown> {
  switch (req.method) {
    case 'init': {
      transformersInitAbort = new AbortController();
      try {
        await transformersRuntime.initialize(req.modelDef!, (p) => {
          const msg: InitProgressUpdate = {
            channel: 'transformers-progress',
            id: req.id,
            progress: p.progress,
            text: p.text,
          };
          chrome.runtime.sendMessage(msg).catch(() => { /* SW may be idle */ });
        }, transformersInitAbort.signal);
        return { ok: true };
      } finally {
        transformersInitAbort = null;
      }
    }
    case 'generate':
      return { ok: true, value: await transformersRuntime.generate(req.messages!, req.maxTokens!, req.params!) };
    case 'interrupt':
      await transformersRuntime.interrupt();
      return { ok: true };
    case 'unload':
      await transformersRuntime.unload();
      return { ok: true };
    case 'countTokens':
      return { ok: true, value: await transformersRuntime.countTokens(req.text!) };
    case 'truncateText':
      return { ok: true, value: await transformersRuntime.truncateText(req.text!, req.maxTokens!) };
  }
}

async function handleChromeAi(req: ChromeAiRequest): Promise<unknown> {
  switch (req.method) {
    case 'checkCapabilities':
      return { ok: true, value: await chromeAiRuntime.checkCapabilities() };
    case 'init':
      await chromeAiRuntime.initialize(req.systemPrompt ?? '');
      return { ok: true };
    case 'generate':
      return { ok: true, value: await chromeAiRuntime.generate(req.userPrompt ?? '') };
    case 'unload':
      chromeAiRuntime.unload();
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const req = message as Partial<SieveOffscreenRequest> | undefined;
  if (!req || !req.target) return false;

  let handler: Promise<unknown> | null = null;
  if (req.target === 'litertlm-offscreen') {
    handler = handleLitertlm(req as LitertlmRequest);
  } else if (req.target === 'sieve-embedder-offscreen') {
    handler = handleEmbedder(req as EmbedderRequest);
  } else if (req.target === 'sieve-transformers-offscreen') {
    handler = handleTransformers(req as TransformersRequest);
  } else if (req.target === 'sieve-chrome-ai-offscreen') {
    handler = handleChromeAi(req as ChromeAiRequest);
  }

  if (!handler) return false;

  handler
    .then(sendResponse)
    .catch((err: unknown) => sendResponse({ ok: false, error: (err as Error).message ?? String(err) }));

  // Keep the message channel open for the async response.
  return true;
});
