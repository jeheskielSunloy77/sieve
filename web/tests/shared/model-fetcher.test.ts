import { describe, it, expect } from 'vitest';
import {
  filterOpenAIModels,
  filterOpenRouterModels,
  filterAnthropicModels,
  filterGeminiModels,
  formatOpenAIDisplayName,
  formatGeminiDisplayName,
  isExcludedModel
} from '../../src/shared/model-fetcher';

describe('model-fetcher', () => {
  describe('OpenAI Model Filtering', () => {
    it('filters out audio, embedding, tts, image, and moderation models', () => {
      const raw = [
        { id: 'whisper-1' },
        { id: 'tts-1' },
        { id: 'tts-1-hd' },
        { id: 'text-embedding-3-small' },
        { id: 'text-embedding-ada-002' },
        { id: 'text-moderation-latest' },
        { id: 'dall-e-3' },
        { id: 'babbage-002' },
        { id: 'gpt-4o-realtime-preview-2024-10-01' },
        { id: 'gpt-4o-audio-preview' },
        { id: 'gpt-image-1.5' },
        { id: 'gpt-image-2' },
        { id: 'gpt-4o-mini', created: 100 },
        { id: 'gpt-4o', created: 90 },
        { id: 'o3-mini', created: 110 },
        { id: 'o1-mini', created: 95 }
      ];

      const filtered = filterOpenAIModels(raw);
      const names = filtered.map(m => m.name);

      expect(names).toContain('gpt-4o-mini');
      expect(names).toContain('gpt-4o');
      expect(names).toContain('o3-mini');
      expect(names).toContain('o1-mini');

      expect(names).not.toContain('whisper-1');
      expect(names).not.toContain('tts-1');
      expect(names).not.toContain('text-embedding-3-small');
      expect(names).not.toContain('dall-e-3');
      expect(names).not.toContain('gpt-4o-realtime-preview-2024-10-01');
      expect(names).not.toContain('gpt-4o-audio-preview');
      expect(names).not.toContain('gpt-image-1.5');
      expect(names).not.toContain('gpt-image-2');

      expect(isExcludedModel('openai', 'gpt-image-1.5')).toBe(true);
      expect(isExcludedModel('openai', 'gpt-4o')).toBe(false);
    });

    it('formats OpenAI display names and assigns low reasoning effort for reasoning models', () => {
      expect(formatOpenAIDisplayName('gpt-4o-mini')).toBe('GPT-4o Mini');
      expect(formatOpenAIDisplayName('gpt-4o')).toBe('GPT-4o');
      expect(formatOpenAIDisplayName('o3-mini')).toBe('o3-mini');

      const filtered = filterOpenAIModels([{ id: 'o3-mini' }, { id: 'gpt-4o-mini' }]);
      const o3 = filtered.find(m => m.name === 'o3-mini');
      const gpt4oMini = filtered.find(m => m.name === 'gpt-4o-mini');

      expect(o3?.apiKwargs).toEqual({ reasoning_effort: 'low' });
      expect(gpt4oMini?.apiKwargs).toBeUndefined();
    });
  });

  describe('OpenRouter Model Filtering', () => {
    it('filters out image and audio models, and flags free models', () => {
      const raw = [
        {
          id: 'black-forest-labs/flux-1-schnell',
          name: 'Flux Schnell',
          architecture: { modality: 'text->image' }
        },
        {
          id: 'meta-llama/llama-3.3-70b-instruct:free',
          name: 'Meta: Llama 3.3 70B Instruct (free)',
          pricing: { prompt: '0', completion: '0' },
          architecture: { modality: 'text->text' }
        },
        {
          id: 'openai/gpt-4o-mini',
          name: 'OpenAI: GPT-4o Mini',
          pricing: { prompt: '0.00000015', completion: '0.0000006' },
          architecture: { modality: 'text->text' }
        },
        {
          id: 'stabilityai/stable-diffusion-xl',
          name: 'SDXL'
        }
      ];

      const filtered = filterOpenRouterModels(raw);
      const names = filtered.map(m => m.name);

      expect(names).toContain('meta-llama/llama-3.3-70b-instruct:free');
      expect(names).toContain('openai/gpt-4o-mini');
      expect(names).not.toContain('black-forest-labs/flux-1-schnell');
      expect(names).not.toContain('stabilityai/stable-diffusion-xl');

      const freeModel = filtered.find(m => m.name === 'meta-llama/llama-3.3-70b-instruct:free');
      expect(freeModel?.isFree).toBe(true);
      expect(freeModel?.display).toBe('Meta: Llama 3.3 70B Instruct');

      // Free models should be sorted first
      expect(filtered[0].isFree).toBe(true);
    });
  });

  describe('Anthropic Model Filtering', () => {
    it('keeps claude models and prioritizes Haiku models for fast filtering', () => {
      const raw = [
        { id: 'claude-3-opus-20240229', display_name: 'Claude 3 Opus' },
        { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-5-haiku-20241022', display_name: 'Claude 3.5 Haiku' }
      ];

      const filtered = filterAnthropicModels(raw);
      expect(filtered.map(m => m.name)).toEqual([
        'claude-3-5-haiku-20241022',
        'claude-3-5-sonnet-20241022',
        'claude-3-opus-20240229'
      ]);
    });
  });

  describe('Gemini Model Filtering', () => {
    it('filters out embedding, imagen, and aqa models', () => {
      const raw = [
        { id: 'models/gemini-2.0-flash' },
        { id: 'models/gemini-1.5-flash' },
        { id: 'models/text-embedding-004' },
        { id: 'models/imagen-3.0-generate-002' },
        { id: 'models/aqa' }
      ];

      const filtered = filterGeminiModels(raw);
      const names = filtered.map(m => m.name);

      expect(names).toContain('gemini-2.0-flash');
      expect(names).toContain('gemini-1.5-flash');
      expect(names).not.toContain('text-embedding-004');
      expect(names).not.toContain('imagen-3.0-generate-002');
      expect(names).not.toContain('aqa');

      expect(formatGeminiDisplayName('gemini-2.0-flash')).toBe('Gemini 2.0 Flash');
    });
  });
});
