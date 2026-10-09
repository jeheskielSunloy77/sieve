import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Mock the local judges so no WKWebView bridge / WebGPU engine is pulled in.
vi.mock('../../src/background/ios-local-bridge.js', () => ({
  iosLocalJudgeAiIntent: vi.fn(),
}));
vi.mock('../../src/background/local-model.js', () => ({
  callLocalAiIntentJudgment: vi.fn(),
}));

const {
  applyAiIntentVerdict, recordAiIntentVerdict,
  refreshAiFilterIntent, pruneAiFilterPhrases,
  phraseSetKey, canJudgeAiIntent,
} = await import('../../src/background/ai-intent.js');
const { iosLocalJudgeAiIntent } = await import('../../src/background/ios-local-bridge.js');
const { callLocalAiIntentJudgment } = await import('../../src/background/local-model.js');
const { aiIntentAutoActive, aiIntentActiveForSite } = await import('../../src/shared/storage.js');
type AiFilterIntentState = import('../../src/types.js').AiFilterIntentState;

const mockIosJudge = iosLocalJudgeAiIntent as unknown as Mock;
const mockLocalJudge = callLocalAiIntentJudgment as unknown as Mock;

// In-memory chrome.storage.local so persistence round-trips.
let store: Record<string, unknown> = {};

beforeEach(() => {
  store = {};
  (chrome.storage.local.get as Mock).mockImplementation((keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (k in store) out[k] = store[k];
    return Promise.resolve(out);
  });
  (chrome.storage.local.set as Mock).mockImplementation((items: Record<string, unknown>) => {
    Object.assign(store, items);
    return Promise.resolve();
  });
  mockIosJudge.mockReset();
  mockLocalJudge.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const state = () => store.aiFilterIntent as AiFilterIntentState;
const setWriteCount = () => (chrome.storage.local.set as Mock).mock.calls.length;

describe('phraseSetKey', () => {
  it('is insensitive to order, casing, whitespace, and duplicates', () => {
    expect(phraseSetKey(['AI slop', 'politics'])).toBe(phraseSetKey(['politics ', 'ai slop', 'AI SLOP']));
  });

  it('distinguishes different sets', () => {
    expect(phraseSetKey(['ai slop'])).not.toBe(phraseSetKey(['ai slop', 'politics']));
  });
});

describe('canJudgeAiIntent', () => {
  it('desktop-local and iOS on-device models can judge; BYOK, cloud, and empty cannot', () => {
    expect(canJudgeAiIntent('local:gemma-4-E2B-it-web')).toBe(true);
    expect(canJudgeAiIntent('iosLocal:gemma-4-e2b-detector-v2')).toBe(true);
    expect(canJudgeAiIntent('openai:gpt-5-nano')).toBe(false);
    expect(canJudgeAiIntent('cloud')).toBe(false);
    expect(canJudgeAiIntent('')).toBe(false);
  });
});

describe('aiIntentActiveForSite', () => {
  const intent = (aiPhrases: string[]): { aiFilterIntent: AiFilterIntentState } => ({
    aiFilterIntent: { aiPhrases, judgedSetKey: null, updatedAt: 1 },
  });

  it('is on only for platforms whose own list contains a judged AI phrase', () => {
    // "AI slop" lives on Twitter only — LinkedIn/YouTube must stay off even
    // though the judged aiPhrases union is non-empty (the reported bug: the
    // sparkle stayed on when switching platforms).
    const data = intent(['AI slop']);
    expect(aiIntentActiveForSite(data, ['AI slop', 'politics'])).toBe(true);
    expect(aiIntentActiveForSite(data, ['politics'])).toBe(false);
    expect(aiIntentActiveForSite(data, [])).toBe(false);
    expect(aiIntentAutoActive(data)).toBe(true); // union stays on (popup)
  });

  it('matches by normalized identity (casing/whitespace)', () => {
    expect(aiIntentActiveForSite(intent(['AI slop']), ['  ai SLOP '])).toBe(true);
  });

  it('is off with empty aiPhrases or pre-migration state, whatever the site list', () => {
    expect(aiIntentActiveForSite(intent([]), ['AI slop'])).toBe(false);
    const legacy = { aiFilterIntent: { intent: true } as unknown as AiFilterIntentState };
    expect(aiIntentActiveForSite(legacy, ['AI slop'])).toBe(false);
    expect(aiIntentActiveForSite({}, ['AI slop'])).toBe(false);
  });
});

describe('applyAiIntentVerdict', () => {
  const union = ['AI slop', 'politics', 'crypto'];

  it('stores the returned phrases verbatim with the judged-set key', () => {
    const r = applyAiIntentVerdict(union, ['AI slop'], 99);
    expect(r).toEqual({ aiPhrases: ['AI slop'], judgedSetKey: phraseSetKey(union), updatedAt: 99 });
  });

  it('an empty verdict clears the phrases but still marks the set judged', () => {
    const r = applyAiIntentVerdict(['politics', 'crypto'], [], 99);
    expect(r.aiPhrases).toEqual([]);
    expect(r.judgedSetKey).toBe(phraseSetKey(['politics', 'crypto']));
  });

  it('the seed phrase survives any verdict, even an empty one', () => {
    const r = applyAiIntentVerdict(union, [], 99);
    expect(r.aiPhrases).toEqual(['AI slop']);
    expect(r.judgedSetKey).toBe(phraseSetKey(union));
  });

  it('defensively drops returned phrases outside the judged set', () => {
    const r = applyAiIntentVerdict(union, ['AI slop', 'not a real phrase'], 99);
    expect(r.aiPhrases).toEqual(['AI slop']);
  });

  it('dedupes by normalized identity and drops blanks', () => {
    const r = applyAiIntentVerdict(union, ['AI slop', ' ai slop ', '  '], 99);
    expect(r.aiPhrases).toEqual(['AI slop']);
  });
});

describe('recordAiIntentVerdict', () => {
  it('does nothing when verdict is null or undefined', async () => {
    await recordAiIntentVerdict(['ai slop'], null);
    expect(store.aiFilterIntent).toBeUndefined();
    await recordAiIntentVerdict(['ai slop'], undefined);
    expect(store.aiFilterIntent).toBeUndefined();
  });

  it('writes next state when verdict is an array', async () => {
    await recordAiIntentVerdict(['ai slop'], ['ai slop']);
    expect(state().aiPhrases).toEqual(['ai slop']);
  });
});

describe('pruneAiFilterPhrases', () => {
  it('turns detection off instantly when all triggering phrases are gone, without a model call', async () => {
    await recordAiIntentVerdict(['AI slop', 'politics'], ['AI slop']);
    expect(aiIntentAutoActive({ aiFilterIntent: state() })).toBe(true);

    store.descriptions_twitter = ['politics']; // "AI slop" deleted
    await pruneAiFilterPhrases();

    expect(mockLocalJudge).not.toHaveBeenCalled();
    expect(state().aiPhrases).toEqual([]);
    expect(aiIntentAutoActive({ aiFilterIntent: state() })).toBe(false);
  });

  it('keeps surviving AI phrases and does not write when nothing was deleted', async () => {
    store.descriptions_twitter = ['AI slop', 'politics'];
    await recordAiIntentVerdict(['AI slop', 'politics'], ['AI slop']);
    const before = setWriteCount();
    await pruneAiFilterPhrases();
    expect(setWriteCount()).toBe(before);
    expect(state().aiPhrases).toEqual(['AI slop']);
  });

  it('delete then re-add re-activates: pruning clears judgedSetKey so the set is re-judged', async () => {
    store.selectedModel = 'local:gemma-4-E2B-it-web';
    store.descriptions_twitter = ['AI slop'];
    mockLocalJudge.mockResolvedValue(['AI slop']);
    await refreshAiFilterIntent();
    expect(state().aiPhrases).toEqual(['AI slop']);

    // Delete: instant off, and the stale judgment must go with it.
    store.descriptions_twitter = [];
    await pruneAiFilterPhrases();
    expect(state().aiPhrases).toEqual([]);
    expect(state().judgedSetKey).toBeNull();

    // Re-add the same phrase: the same set key must NOT be treated as already judged
    store.descriptions_twitter = ['AI slop'];
    await refreshAiFilterIntent();
    expect(mockLocalJudge).toHaveBeenCalledTimes(2);
    expect(state().aiPhrases).toEqual(['AI slop']);
    expect(aiIntentAutoActive({ aiFilterIntent: state() })).toBe(true);
  });
});

describe('refreshAiFilterIntent', () => {
  it('clears state deterministically when no phrases exist, without a model call', async () => {
    await recordAiIntentVerdict(['ai slop'], ['ai slop']);
    await refreshAiFilterIntent();
    expect(mockLocalJudge).not.toHaveBeenCalled();
    expect(state().aiPhrases).toEqual([]);
    expect(aiIntentAutoActive({ aiFilterIntent: state() })).toBe(false);
  });

  it('judges the current phrases via local judge and applies the verdict', async () => {
    store.descriptions_twitter = ['ai slop', 'politics'];
    store.selectedModel = 'local:gemma-4-E2B-it-web';
    mockLocalJudge.mockResolvedValue(['ai slop']);

    await refreshAiFilterIntent();

    expect(mockLocalJudge).toHaveBeenCalledTimes(1);
    const [phrases] = mockLocalJudge.mock.calls[0] as [string[]];
    expect([...phrases].sort()).toEqual(['ai slop', 'politics']);
    expect(state().aiPhrases).toEqual(['ai slop']);
    expect(state().judgedSetKey).toBe(phraseSetKey(['ai slop', 'politics']));
  });

  it('never re-probes a set that was already judged', async () => {
    store.descriptions_twitter = ['ai slop'];
    store.selectedModel = 'local:gemma-4-E2B-it-web';
    mockLocalJudge.mockResolvedValue(['ai slop']);

    await refreshAiFilterIntent();
    await refreshAiFilterIntent();
    expect(mockLocalJudge).toHaveBeenCalledTimes(1);
  });

  it('does not double-probe when a second refresh starts while the probe is in flight', async () => {
    store.descriptions_twitter = ['ai slop'];
    store.selectedModel = 'local:gemma-4-E2B-it-web';
    let resolveProbe!: (v: unknown) => void;
    mockLocalJudge.mockImplementation(() => new Promise(r => { resolveProbe = r; }));

    const first = refreshAiFilterIntent();
    const second = refreshAiFilterIntent(); // reaches the in-flight guard and returns
    await second;
    resolveProbe(['ai slop']);
    await first;

    expect(mockLocalJudge).toHaveBeenCalledTimes(1);
    expect(state().aiPhrases).toEqual(['ai slop']);
  });

  it('prunes deleted phrases locally, even when probing is gated (non-local model)', async () => {
    await recordAiIntentVerdict(['ai slop', 'politics'], ['ai slop']);
    store.descriptions_twitter = ['politics']; // "ai slop" deleted
    store.selectedModel = 'openai:gpt-5';

    await refreshAiFilterIntent();

    expect(mockLocalJudge).not.toHaveBeenCalled();
    expect(state().aiPhrases).toEqual([]);
  });

  it('does not probe when a BYOK model is selected', async () => {
    store.descriptions_twitter = ['ai slop'];
    store.selectedModel = 'openai:gpt-5';
    await refreshAiFilterIntent();
    expect(mockIosJudge).not.toHaveBeenCalled();
    expect(mockLocalJudge).not.toHaveBeenCalled();
  });

  it('judges via the on-device model when iosLocal is selected', async () => {
    store.descriptions_twitter = ['ai slop', 'politics'];
    store.selectedModel = 'iosLocal:gemma-4-e2b-detector-v2';
    mockIosJudge.mockResolvedValue(['ai slop']);

    await refreshAiFilterIntent();

    expect(mockIosJudge).toHaveBeenCalledTimes(1);
    const [phrases] = mockIosJudge.mock.calls[0] as [string[]];
    expect([...phrases].sort()).toEqual(['ai slop', 'politics']);
    expect(state().aiPhrases).toEqual(['ai slop']);
    expect(state().judgedSetKey).toBe(phraseSetKey(['ai slop', 'politics']));
    expect(aiIntentAutoActive({ aiFilterIntent: state() })).toBe(true);
  });

  it('a null (unparseable) local verdict leaves judgedSetKey stale so the next trigger retries', async () => {
    store.descriptions_twitter = ['ai slop'];
    store.selectedModel = 'local:gemma-4-E2B-it-web';
    mockLocalJudge.mockResolvedValueOnce(null);

    await refreshAiFilterIntent();
    expect(state()?.judgedSetKey ?? null).toBeNull();

    mockLocalJudge.mockResolvedValue(['ai slop']);
    await refreshAiFilterIntent();
    expect(mockLocalJudge).toHaveBeenCalledTimes(2);
    expect(state().aiPhrases).toEqual(['ai slop']);
  });

  it('survives a local judge failure without touching state, then retries on the next call', async () => {
    await recordAiIntentVerdict(['ai slop'], ['ai slop']);
    store.descriptions_twitter = ['ai slop', 'politics'];
    store.selectedModel = 'local:gemma-4-E2B-it-web';
    mockLocalJudge.mockRejectedValueOnce(new Error('Inference error'));

    await expect(refreshAiFilterIntent()).resolves.toBeUndefined();
    expect(state().aiPhrases).toEqual(['ai slop']);

    mockLocalJudge.mockResolvedValue(['ai slop', 'politics']);
    await refreshAiFilterIntent();
    expect(mockLocalJudge).toHaveBeenCalledTimes(2);
    expect(state().aiPhrases).toEqual(['ai slop', 'politics']);
  });

  it('treats pre-migration state (boolean latch, no aiPhrases) as empty', async () => {
    store.aiFilterIntent = { intent: true, phraseSetKey: 'ai slop', updatedAt: 1 };
    expect(aiIntentAutoActive({ aiFilterIntent: store.aiFilterIntent as AiFilterIntentState })).toBe(false);

    store.descriptions_twitter = ['ai slop'];
    store.selectedModel = 'local:gemma-4-E2B-it-web';
    mockLocalJudge.mockResolvedValue(['ai slop']);

    await refreshAiFilterIntent();
    expect(state().aiPhrases).toEqual(['ai slop']);
    expect(aiIntentAutoActive({ aiFilterIntent: state() })).toBe(true);
  });
});
