// ============================================================
// LLM Provider Factory
// ============================================================

import type {
  AppConfig,
  LLMProvider,
  ProviderConfig,
  ProviderFamily,
  ProviderType,
} from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

export type { ProviderType } from '../types.js';

export function normalizeProviderType(type: ProviderType): ProviderFamily {
  switch (type) {
    case 'anthropic':
    case 'claude':
      return 'anthropic';
    case 'openai':
    case 'openai-compatible':
    case 'codex':
      return 'openai';
    default:
      throw new Error(`Unknown provider: ${type}`);
  }
}

export function resolveProviderConfig(
  appConfig: AppConfig | undefined,
  providerType: ProviderType,
): ProviderConfig | undefined {
  if (!appConfig) return undefined;

  switch (providerType) {
    case 'claude':
      return appConfig.claude ?? appConfig.anthropic;
    case 'anthropic':
      return appConfig.anthropic ?? appConfig.claude;
    case 'openai-compatible':
      return appConfig['openai-compatible'] ?? appConfig.openai ?? appConfig.codex;
    case 'codex':
      return appConfig.codex ?? appConfig.openai ?? appConfig['openai-compatible'];
    case 'openai':
      return appConfig.openai ?? appConfig['openai-compatible'] ?? appConfig.codex;
    default:
      return undefined;
  }
}

/**
 * Factory function to create LLM providers by type.
 * Routes aliases onto the underlying protocol implementation.
 */
export function createProvider(type: ProviderType, config: ProviderConfig): LLMProvider {
  switch (normalizeProviderType(type)) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    default:
      throw new Error(`Unknown provider: ${type}`);
  }
}

export type { LLMProvider, ProviderConfig } from '../types.js';
