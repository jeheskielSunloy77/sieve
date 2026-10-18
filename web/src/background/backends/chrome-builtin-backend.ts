// Chrome Built-in AI (Gemini Nano) backend implementing LocalBackend.
// Routes to the offscreen document where window.ai.languageModel is available.

import type { LocalModelDef, ChatMessage } from '../../types';
import type { LocalBackend, InitProgress } from './types';
import { LOCAL_SYSTEM_PROMPT } from '../../shared/prompts';

const OFFSCREEN_URL = 'offscreen.html';
let nextRequestId = 1;

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
      justification: 'Run Chrome Built-in AI (Gemini Nano) inference.',
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

async function sendToChromeAi<T>(payload: Record<string, unknown>): Promise<T> {
  await ensureOffscreen();
  const id = nextRequestId++;
  const resp = await chrome.runtime.sendMessage<unknown, OffscreenResponse<T>>({
    target: 'sieve-chrome-ai-offscreen',
    id,
    ...payload,
  });
  if (!resp?.ok) throw new Error(resp?.error ?? 'Chrome Built-in AI request failed');
  return resp.value as T;
}

export class ChromeBuiltinBackend implements LocalBackend {
  private isLoaded: boolean = false;

  static async isAvailable(): Promise<boolean> {
    try {
      const caps = await sendToChromeAi<{ available: 'no' | 'readily' | 'after-download' }>({
        method: 'checkCapabilities',
      });
      return caps?.available === 'readily' || caps?.available === 'after-download';
    } catch {
      return false;
    }
  }

  async initialize(
    _modelDef: LocalModelDef,
    onProgress: (p: InitProgress) => void,
    _abortSignal: AbortSignal
  ): Promise<void> {
    onProgress({ progress: 0.1, text: 'Connecting to Chrome Built-in AI...' });
    const caps = await sendToChromeAi<{ available: 'no' | 'readily' | 'after-download' }>({
      method: 'checkCapabilities',
    });

    if (caps.available === 'no') {
      throw new Error('Chrome Built-in AI (Gemini Nano) is not enabled in this browser. It requires official Google Chrome 128+ with Prompt API flags enabled, or use Qwen 2.5.');
    }
    if (caps.available === 'after-download') {
      onProgress({ progress: 0.5, text: 'Chrome is downloading the on-device AI model...' });
    }

    await sendToChromeAi({
      method: 'init',
      systemPrompt: LOCAL_SYSTEM_PROMPT,
    });

    this.isLoaded = true;
    onProgress({ progress: 1.0, text: 'Chrome Built-in AI ready' });
  }

  async unload(): Promise<void> {
    if (this.isLoaded) {
      await sendToChromeAi({ method: 'unload' }).catch(() => { /* ignore */ });
      this.isLoaded = false;
    }
  }

  async generate(
    messages: ChatMessage[],
    _maxTokens: number,
    _params: Record<string, unknown>
  ): Promise<string> {
    // Extract system prompt and user text
    let systemPrompt = LOCAL_SYSTEM_PROMPT;
    let userPrompt = '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = typeof msg.content === 'string' ? msg.content : LOCAL_SYSTEM_PROMPT;
      } else if (msg.role === 'user') {
        userPrompt = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      }
    }

    // Ensure session has the matching system prompt
    await sendToChromeAi({ method: 'init', systemPrompt });
    return await sendToChromeAi<string>({
      method: 'generate',
      userPrompt,
    });
  }

  interrupt(): Promise<void> {
    // Chrome AI does not expose an interrupt token, no-op
    return Promise.resolve();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async countTokens(text: string): Promise<number> {
    return Math.ceil(text.length / 3.5);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async truncateText(text: string, maxTokens: number): Promise<string> {
    const maxChars = Math.floor(maxTokens * 3.5);
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getImageEmbedSize(): Promise<number> {
    return 0;
  }
}
