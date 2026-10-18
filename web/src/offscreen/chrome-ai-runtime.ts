// Chrome Built-in AI (ai.languageModel / Gemini Nano) runtime.
// Runs in DOM/window contexts such as the Chrome offscreen document.

interface AILanguageModelCapabilities {
  available: 'no' | 'readily' | 'after-download';
  defaultTemperature?: number;
  defaultTopK?: number;
  maxTopK?: number;
}

interface AILanguageModelSession {
  prompt(input: string): Promise<string>;
  destroy(): void;
  clone(): Promise<AILanguageModelSession>;
}

interface AILanguageModelFactory {
  capabilities(): Promise<AILanguageModelCapabilities>;
  create(options?: {
    systemPrompt?: string;
    temperature?: number;
    topK?: number;
    signal?: AbortSignal;
  }): Promise<AILanguageModelSession>;
}

declare global {
  interface Window {
    ai?: {
      languageModel?: AILanguageModelFactory;
    };
    LanguageModel?: {
      availability?: (options?: unknown) => Promise<string>;
      create: (options?: unknown) => Promise<AILanguageModelSession>;
    };
  }
}

function getAiLanguageModelFactory(): AILanguageModelFactory | null {
  const globalScope = typeof globalThis !== 'undefined'
    ? (globalThis as unknown as Window)
    : (typeof window !== 'undefined' ? window : null);

  if (!globalScope) return null;

  // 1. Modern standardized LanguageModel global
  if (globalScope.LanguageModel && typeof globalScope.LanguageModel.create === 'function') {
    const lm = globalScope.LanguageModel;
    return {
      capabilities: async () => {
        if (typeof lm.availability === 'function') {
          try {
            const avail = await lm.availability();
            if (avail === 'available' || avail === 'readily') return { available: 'readily' };
            if (avail === 'downloadable' || avail === 'after-download' || avail === 'downloading') return { available: 'after-download' };
            return { available: 'no' };
          } catch {
            return { available: 'no' };
          }
        }
        return { available: 'readily' };
      },
      create: (options) => lm.create(options),
    };
  }

  // 2. window.ai.languageModel
  if (globalScope.ai?.languageModel) {
    return globalScope.ai.languageModel;
  }

  return null;
}

export class ChromeAiRuntime {
  private session: AILanguageModelSession | null = null;
  private currentSystemPrompt: string = '';

  async checkCapabilities(): Promise<{ available: 'no' | 'readily' | 'after-download' }> {
    const factory = getAiLanguageModelFactory();
    if (!factory || typeof factory.capabilities !== 'function') {
      return { available: 'no' };
    }
    try {
      const caps = await factory.capabilities();
      return { available: caps.available };
    } catch (err) {
      console.warn('[ChromeAiRuntime] Error querying capabilities:', err);
      return { available: 'no' };
    }
  }

  async initialize(systemPrompt: string = '', signal?: AbortSignal): Promise<void> {
    const factory = getAiLanguageModelFactory();
    if (!factory) {
      throw new Error('Chrome Built-in AI (ai.languageModel) is not available in this browser.');
    }

    if (this.session && this.currentSystemPrompt === systemPrompt) {
      return;
    }

    if (this.session) {
      this.unload();
    }

    this.currentSystemPrompt = systemPrompt;
    this.session = await factory.create({
      systemPrompt: systemPrompt || undefined,
      temperature: 0.0,
      topK: 1,
      signal,
    });
  }

  async generate(userPrompt: string): Promise<string> {
    if (!this.session) {
      await this.initialize(this.currentSystemPrompt);
    }
    if (!this.session) {
      throw new Error('Chrome Built-in AI session could not be created');
    }
    return await this.session.prompt(userPrompt);
  }

  unload(): void {
    if (this.session) {
      try {
        this.session.destroy();
      } catch (err) {
        console.warn('[ChromeAiRuntime] Error destroying session:', err);
      }
      this.session = null;
    }
  }
}
