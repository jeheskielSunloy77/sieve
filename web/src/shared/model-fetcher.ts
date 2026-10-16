// Dynamic model fetcher & filter for cloud providers (OpenRouter, OpenAI, Anthropic, Gemini)
// Local models remain static / on-device.

import type { ModelDef } from '../types';

export function formatOpenAIDisplayName(id: string): string {
  if (id === 'gpt-4o') return 'GPT-4o';
  if (id === 'gpt-4o-mini') return 'GPT-4o Mini';
  if (id === 'o1') return 'o1';
  if (id === 'o1-mini') return 'o1-mini';
  if (id === 'o3-mini') return 'o3-mini';
  if (id === 'gpt-4-turbo') return 'GPT-4 Turbo';
  if (id === 'gpt-4') return 'GPT-4';
  if (id === 'gpt-3.5-turbo') return 'GPT-3.5 Turbo';

  return id
    .replace(/^gpt-/, 'GPT-')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

export function formatGeminiDisplayName(id: string): string {
  const clean = id.replace(/^models\//, '');
  if (clean === 'gemini-2.0-flash') return 'Gemini 2.0 Flash';
  if (clean === 'gemini-2.0-flash-lite' || clean.includes('gemini-2.0-flash-lite')) return 'Gemini 2.0 Flash Lite';
  if (clean === 'gemini-1.5-flash') return 'Gemini 1.5 Flash';
  if (clean === 'gemini-1.5-flash-8b') return 'Gemini 1.5 Flash 8B';
  if (clean === 'gemini-1.5-pro') return 'Gemini 1.5 Pro';
  if (clean.includes('gemini-2.5-flash')) return 'Gemini 2.5 Flash';

  return clean
    .replace(/^gemini-/, 'Gemini ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

const OPENAI_EXCLUDED_PATTERNS = [
  'realtime',
  'audio',
  'transcribe',
  'tts',
  'embedding',
  'moderation',
  'dall-e',
  'whisper',
  'davinci',
  'babbage',
  'search',
  'similarity',
  'instruct-preview'
];

export function filterOpenAIModels(rawModels: Array<{ id?: string; created?: number }>): ModelDef[] {
  const filtered = rawModels.filter(m => {
    if (!m.id) return false;
    const lower = m.id.toLowerCase();
    const isChat = lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('chatgpt-');
    if (!isChat) return false;
    return !OPENAI_EXCLUDED_PATTERNS.some(pat => lower.includes(pat));
  });

  const PRIORITY_ORDER: Record<string, number> = {
    'gpt-4o-mini': 1,
    'gpt-4o': 2,
    'o3-mini': 3,
    'o1-mini': 4,
    'o1': 5,
    'gpt-4-turbo': 6,
    'gpt-3.5-turbo': 7
  };

  filtered.sort((a, b) => {
    const idA = a.id || '';
    const idB = b.id || '';
    const rankA = PRIORITY_ORDER[idA] ?? 99;
    const rankB = PRIORITY_ORDER[idB] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return (b.created || 0) - (a.created || 0);
  });

  return filtered.map(m => {
    const id = m.id!;
    const def: ModelDef = {
      name: id,
      display: formatOpenAIDisplayName(id),
      api: 'openai'
    };
    if (id.startsWith('o1') || id.startsWith('o3')) {
      def.apiKwargs = { reasoning_effort: 'low' };
    }
    return def;
  });
}

export interface OpenRouterRawModel {
  id?: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string };
  context_length?: number;
}

export function filterOpenRouterModels(rawModels: OpenRouterRawModel[]): ModelDef[] {
  const filtered = rawModels.filter(m => {
    if (!m.id) return false;
    const lower = m.id.toLowerCase();
    // Exclude image generation, audio, embedding, tts
    if (
      lower.includes('flux') ||
      lower.includes('midjourney') ||
      lower.includes('dall-e') ||
      lower.includes('whisper') ||
      lower.includes('embedding') ||
      lower.includes('tts') ||
      lower.includes('speech') ||
      lower.includes('stable-diffusion')
    ) {
      return false;
    }
    const modality = m.architecture?.modality?.toLowerCase();
    if (modality && !modality.endsWith('->text') && !modality.includes('text')) {
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const idA = a.id || '';
    const idB = b.id || '';
    const aFree = a.pricing?.prompt === '0' || idA.endsWith(':free');
    const bFree = b.pricing?.prompt === '0' || idB.endsWith(':free');
    if (aFree && !bFree) return -1;
    if (!aFree && bFree) return 1;
    return (a.name || idA).localeCompare(b.name || idB);
  });

  return filtered.map(m => {
    const id = m.id!;
    const isFree = m.pricing?.prompt === '0' || id.endsWith(':free');
    return {
      name: id,
      display: m.name ? m.name.replace(/\s*\(free\)$/i, '').trim() : id,
      isFree,
      api: 'openrouter'
    };
  });
}

export interface AnthropicRawModel {
  id?: string;
  display_name?: string;
  created_at?: string;
}

export function filterAnthropicModels(rawModels: AnthropicRawModel[]): ModelDef[] {
  const filtered = rawModels.filter(m => m.id && m.id.startsWith('claude-'));

  filtered.sort((a, b) => {
    const idA = (a.id || '').toLowerCase();
    const idB = (b.id || '').toLowerCase();
    const getPriority = (id: string) => {
      if (id.includes('haiku')) return 1;
      if (id.includes('sonnet')) return 2;
      if (id.includes('opus')) return 3;
      return 4;
    };
    const pA = getPriority(idA);
    const pB = getPriority(idB);
    if (pA !== pB) return pA - pB;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });

  return filtered.map(m => ({
    name: m.id!,
    display: m.display_name || m.id!,
    api: 'anthropic'
  }));
}

export interface GeminiRawModel {
  id?: string;
  name?: string;
}

const GEMINI_EXCLUDED_PATTERNS = [
  'embedding',
  'imagen',
  'aqa',
  'robotics',
  'custom',
  'vision'
];

export function filterGeminiModels(rawModels: GeminiRawModel[]): ModelDef[] {
  const filtered = rawModels.filter(m => {
    const rawId = m.id || m.name || '';
    const cleanId = rawId.replace(/^models\//, '');
    const lower = cleanId.toLowerCase();
    if (!lower.startsWith('gemini-')) return false;
    return !GEMINI_EXCLUDED_PATTERNS.some(pat => lower.includes(pat));
  });

  filtered.sort((a, b) => {
    const idA = (a.id || a.name || '').toLowerCase();
    const idB = (b.id || b.name || '').toLowerCase();
    const getPriority = (id: string) => {
      if (id.includes('2.0-flash')) return 1;
      if (id.includes('1.5-flash')) return 2;
      if (id.includes('flash')) return 3;
      if (id.includes('pro')) return 4;
      return 5;
    };
    const pA = getPriority(idA);
    const pB = getPriority(idB);
    if (pA !== pB) return pA - pB;
    return idA.localeCompare(idB);
  });

  return filtered.map(m => {
    const id = (m.id || m.name || '').replace(/^models\//, '');
    return {
      name: id,
      display: formatGeminiDisplayName(id),
      api: 'gemini'
    };
  });
}

/**
 * Fetch and filter models for a given provider.
 * Returns filtered ModelDef array on success, or empty array on failure.
 */
export async function fetchProviderModels(
  api: string,
  apiKey: string,
  apiBase?: string
): Promise<ModelDef[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let models: ModelDef[] = [];

    if (api === 'openrouter') {
      const headers: Record<string, string> = {
        'HTTP-Referer': 'https://github.com/jeheskielSunloy77/post-patrol',
        'X-Title': 'Post Patrol'
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers,
        signal: controller.signal
      });
      if (res.ok) {
        const json = await res.json() as { data?: OpenRouterRawModel[] };
        if (Array.isArray(json.data)) {
          models = filterOpenRouterModels(json.data);
        }
      }
    } else if (api === 'openai') {
      if (!apiKey) return [];
      const base = (apiBase || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const res = await fetch(`${base}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: controller.signal
      });
      if (res.ok) {
        const json = await res.json() as { data?: Array<{ id?: string; created?: number }> };
        if (Array.isArray(json.data)) {
          models = filterOpenAIModels(json.data);
        }
      }
    } else if (api === 'anthropic') {
      if (!apiKey) return [];
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        signal: controller.signal
      });
      if (res.ok) {
        const json = await res.json() as { data?: AnthropicRawModel[] };
        if (Array.isArray(json.data)) {
          models = filterAnthropicModels(json.data);
        }
      }
    } else if (api === 'gemini') {
      if (!apiKey) return [];
      // Try OpenAI-compatible endpoint first
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: controller.signal
      });
      if (res.ok) {
        const json = await res.json() as { data?: GeminiRawModel[] };
        if (Array.isArray(json.data)) {
          models = filterGeminiModels(json.data);
        }
      } else {
        // Fallback to standard Google models endpoint
        const fallbackRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
          signal: controller.signal
        });
        if (fallbackRes.ok) {
          const json = await fallbackRes.json() as { models?: GeminiRawModel[] };
          if (Array.isArray(json.models)) {
            models = filterGeminiModels(json.models);
          }
        }
      }
    }

    clearTimeout(timeoutId);
    return models;
  } catch (err) {
    console.warn(`[ModelFetcher] Failed to fetch models for ${api}:`, err);
    return [];
  }
}
