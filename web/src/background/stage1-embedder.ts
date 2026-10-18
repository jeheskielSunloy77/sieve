// Service worker proxy for Stage 1 Embedder.
// Handles lifecycle of the offscreen document and dispatches evaluation requests.

export interface Stage1EvaluationResult {
  isMatch: boolean;
  maxSimilarity: number;
  topPhrase?: string;
  reason?: string;
}

const OFFSCREEN_URL = 'offscreen.html';

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
      justification: 'Run Stage 1 embedding pre-filter and on-device AI inference.',
    });
  } catch (err: unknown) {
    // If document already exists or was created concurrently, ignore
    const msg = (err as Error)?.message ?? '';
    if (!msg.includes('Only a single offscreen document may be created')) {
      throw err;
    }
  }
}

export class Stage1Embedder {
  private enabled: boolean = true;
  private similarityThreshold: number = 0.08;

  constructor(options?: { enabled?: boolean; similarityThreshold?: number }) {
    if (options?.enabled !== undefined) this.enabled = options.enabled;
    if (options?.similarityThreshold !== undefined) this.similarityThreshold = options.similarityThreshold;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setThreshold(threshold: number): void {
    this.similarityThreshold = threshold;
  }

  /**
   * Evaluates post text against user's filter phrases.
   * Returns isMatch: false ONLY when post is definitively not related to any phrase.
   * In all ambiguous or failure cases, returns isMatch: true (fail-open).
   */
  async evaluatePost(postText: string, filterPhrases: string[]): Promise<Stage1EvaluationResult> {
    if (!this.enabled || !filterPhrases || filterPhrases.length === 0) {
      return { isMatch: true, maxSimilarity: 1.0, reason: 'Stage 1 bypassed or no filter phrases' };
    }

    const trimmed = postText.trim();
    if (!trimmed) {
      return { isMatch: false, maxSimilarity: -1.0, reason: 'Empty post text' };
    }

    // Fast synchronous lexical check in SW first
    const lower = trimmed.toLowerCase();
    for (const phrase of filterPhrases) {
      const lowerPhrase = phrase.trim().toLowerCase();
      if (lowerPhrase.length > 2 && lower.includes(lowerPhrase)) {
        return {
          isMatch: true,
          maxSimilarity: 1.0,
          topPhrase: phrase,
          reason: `SW Lexical keyword match: "${phrase}"`,
        };
      }
    }

    // If chrome.offscreen is unavailable (e.g. Safari / iOS), fail-open to Stage 2
    if (typeof chrome === 'undefined' || !chrome.offscreen || !chrome.runtime?.sendMessage) {
      return { isMatch: true, maxSimilarity: 1.0, reason: 'Offscreen unavailable in this environment' };
    }

    try {
      await ensureOffscreen();
      const response = await chrome.runtime.sendMessage<{
        target: string;
        method: string;
        postText: string;
        filterPhrases: string[];
        threshold: number;
      }, { ok: boolean; value?: Stage1EvaluationResult; error?: string }>({
        target: 'sieve-embedder-offscreen',
        method: 'evaluateSimilarity',
        postText: trimmed,
        filterPhrases,
        threshold: this.similarityThreshold,
      });

      if (response && response.ok && response.value) {
        return response.value;
      }
      return { isMatch: true, maxSimilarity: 1.0, reason: response?.error ?? 'Offscreen returned failure' };
    } catch (err) {
      console.warn('[Stage1Embedder] Offscreen embedder evaluation failed, failing open:', err);
      return { isMatch: true, maxSimilarity: 1.0, reason: 'Embedder communication error' };
    }
  }
}

export const stage1Embedder = new Stage1Embedder();
