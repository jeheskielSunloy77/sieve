// Shared model definitions for PostPatrol
// Used by both background and popup (via esbuild bundling)

import type { PredefinedModelsMap } from '../types';

// iOS on-device model catalog, injected by the native app: FilteredWebView
// prepends `var __iosLocalModels = [...]` (serialized from the Swift
// registry, LocalInferenceService.models) to ChromePolyfill.js, which runs
// before any bundle that imports this module. That registry is the single
// source of truth for iOS models — ids, display names, sizes, and the
// device-RAM support flag all come from it. Desktop/extension builds have no
// such global and get an empty list; the iosLocal provider is only reachable
// in-app anyway.
interface InjectedIosModel {
  name: string;
  display: string;
  size: string;        // e.g. "~2.2 GB"
  isSupported: boolean;
  requiredRAM: string; // e.g. "6 GB"
}
const injectedIosModels: InjectedIosModel[] =
  (globalThis as { __iosLocalModels?: InjectedIosModel[] }).__iosLocalModels ?? [];

// Loudness guard: inside the app (ChromePolyfill sets chrome._polyfilled) the
// catalog must exist and be non-empty — an empty list here means the
// injection-order invariant broke (some bundle importing this module ran
// before ChromePolyfill) and the popup would silently lose its on-device
// model row. Warn so the failure is diagnosable from the console.
const inApp = typeof chrome !== 'undefined' &&
  (chrome as unknown as { _polyfilled?: boolean })._polyfilled;
if (inApp && injectedIosModels.length === 0) {
  console.warn(
    '[models] __iosLocalModels missing/empty in app mode — native catalog ' +
    'injection did not run before this bundle; on-device model UI will be absent.',
  );
}

export const PREDEFINED_MODELS: PredefinedModelsMap = {
  local: [
    {
      name: "gemma-4-E2B-it-web",
      display: "Gemma 4 E2B (Instruct)",
      isLocal: true,
      backend: 'litertlm',
      supportsImages: false,
      sizeGB: 2.0,
      inferenceParams: { temperature: 0.0 },
      litertlmConfig: {
        modelUrl: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm",
        maxTokens: 1024,
        topK: 40,
      }
    },
    {
      name: "gemma-4-E4B-it-web",
      display: "Gemma 4 E4B (Instruct)",
      isLocal: true,
      backend: 'litertlm',
      supportsImages: false,
      sizeGB: 3.0,
      inferenceParams: { temperature: 0.0 },
      litertlmConfig: {
        modelUrl: "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm",
        maxTokens: 1024,
        topK: 40,
      }
    }
  ],
  openrouter: [
    { name: "meta-llama/llama-3.3-70b-instruct:free", display: "Llama 3.3 70B Instruct", isFree: true },
    { name: "google/gemini-2.0-flash-001", display: "Gemini 2.0 Flash", isFree: false }
  ],
  openai: [
    { name: 'gpt-4o-mini', display: 'GPT-4o Mini' },
    { name: 'gpt-4o', display: 'GPT-4o' },
    { name: 'o3-mini', display: 'o3-mini', apiKwargs: { reasoning_effort: "low" } }
  ],
  gemini: [
    { name: 'gemini-2.0-flash', display: 'Gemini 2.0 Flash' },
    { name: 'gemini-2.0-flash-lite', display: 'Gemini 2.0 Flash Lite' },
    { name: 'gemini-1.5-flash', display: 'Gemini 1.5 Flash' }
  ],
  anthropic: [
    { name: 'claude-3-5-haiku-20241022', display: 'Claude 3.5 Haiku' },
    { name: 'claude-3-7-sonnet-20250219', display: 'Claude 3.7 Sonnet' }
  ],
  // Populated from the injected native catalog (see InjectedIosModel above).
  // The native side resolves files/URLs from the "iosLocal:<id>" key.
  iosLocal: injectedIosModels.map((m) => ({
    name: m.name,
    display: m.display,
    isLocal: true,
    supportsImages: false,
    sizeDisplay: m.size,
    isSupportedOnThisDevice: m.isSupported,
    requiredRAMDisplay: m.requiredRAM,
  })),
};

// Default model: empty string represents "no model configured" and
// triggers the model picker / OpenRouter auto-switch.
export const DEFAULT_MODEL = '';

export const API_DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  local: 'Local',
  iosLocal: 'On-device (iOS)'
};

export const API_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  anthropic: 'https://api.anthropic.com/v1'
};
