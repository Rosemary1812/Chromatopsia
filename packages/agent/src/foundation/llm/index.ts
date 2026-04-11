// ============================================================
// LLM Provider Factory
// ============================================================
// T-03: Provider routing factory

import type { LLMProvider, ProviderConfig } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

export type ProviderType = 'anthropic' | 'openai';

/**
 * Factory function to create LLM providers by type.
 * Routes to the appropriate provider implementation based on the type string.
 */
export function createProvider(type: ProviderType, config: ProviderConfig): LLMProvider {
  switch (type) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    default:
      throw new Error(`Unknown provider: ${type}`);
  }
}

// Re-export provider types
export type { LLMProvider, ProviderConfig } from '../types.js';
