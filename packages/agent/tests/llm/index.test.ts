import { describe, it, expect } from 'vitest';
import {
  createProvider,
  normalizeProviderType,
  resolveProviderConfig,
  type ProviderType,
} from '../../src/foundation/llm/index.js';
import type { AppConfig, ProviderConfig } from '../../src/foundation/types.js';
import { AnthropicProvider } from '../../src/foundation/llm/anthropic.js';
import { OpenAIProvider } from '../../src/foundation/llm/openai.js';

describe('createProvider', () => {
  const mockConfig: ProviderConfig = {
    api_key: 'test-api-key',
  };

  it('normalizes provider aliases onto provider families', () => {
    expect(normalizeProviderType('openai')).toBe('openai');
    expect(normalizeProviderType('openai-compatible')).toBe('openai');
    expect(normalizeProviderType('codex')).toBe('openai');
    expect(normalizeProviderType('anthropic')).toBe('anthropic');
    expect(normalizeProviderType('claude')).toBe('anthropic');
  });

  it('routes openai-compatible aliases to OpenAIProvider', () => {
    expect(createProvider('openai', mockConfig)).toBeInstanceOf(OpenAIProvider);
    expect(createProvider('openai-compatible', mockConfig)).toBeInstanceOf(OpenAIProvider);
    expect(createProvider('codex', mockConfig)).toBeInstanceOf(OpenAIProvider);
  });

  it('routes anthropic aliases to AnthropicProvider', () => {
    expect(createProvider('anthropic', mockConfig)).toBeInstanceOf(AnthropicProvider);
    expect(createProvider('claude', mockConfig)).toBeInstanceOf(AnthropicProvider);
  });

  it('throws error for unknown provider type', () => {
    expect(() => createProvider('unknown' as ProviderType, mockConfig))
      .toThrow('Unknown provider: unknown');
  });

  it('resolves provider config from matching alias block first', () => {
    const appConfig: AppConfig = {
      provider: 'openai-compatible',
      openai: { api_key: 'fallback-openai', base_url: 'https://api.openai.com/v1' },
      'openai-compatible': { api_key: 'compatible-key', base_url: 'https://openrouter.ai/api/v1' },
    };

    expect(resolveProviderConfig(appConfig, 'openai-compatible')).toEqual({
      api_key: 'compatible-key',
      base_url: 'https://openrouter.ai/api/v1',
    });
  });

  it('falls back across equivalent config families', () => {
    const appConfig: AppConfig = {
      provider: 'claude',
      anthropic: { api_key: 'anthropic-key', model: 'claude-opus-4-6' },
    };

    expect(resolveProviderConfig(appConfig, 'claude')).toEqual({
      api_key: 'anthropic-key',
      model: 'claude-opus-4-6',
    });
  });
});
