/**
 * Token Counter & Estimator
 *
 * Provides quick token estimation for context window management.
 * Uses heuristics since we don't have access to provider's tokenizer.
 *
 * Model token limits:
 * - Claude 3.5 Sonnet: 200k
 * - Claude 3 Opus: 200k
 * - GPT-4: 8k/32k/128k (context window varies)
 * - GPT-4 Turbo: 128k
 */

import type { Message } from '../types.js';

export interface ModelTokenLimit {
  model: string;
  contextWindow: number;
  trainingDataCutoff?: string;
}

/**
 * Known model token limits (conservative estimates)
 */
export const MODEL_TOKEN_LIMITS: Record<string, number> = {
  // Claude models
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-opus-20240229': 200_000,
  'claude-3-sonnet-20240229': 200_000,
  'claude-3-haiku-20240307': 200_000,

  // GPT-4 models
  'gpt-4': 8_192,
  'gpt-4-32k': 32_768,
  'gpt-4-turbo': 128_000,
  'gpt-4-turbo-preview': 128_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,

  // GPT-3.5
  'gpt-3.5-turbo': 4_096,
  'gpt-3.5-turbo-16k': 16_384,

  // Fallback
  'default': 8_192,
};

/**
 * Get context window size for a model
 */
export function getContextWindowSize(modelName: string): number {
  // Try exact match
  if (modelName in MODEL_TOKEN_LIMITS) {
    return MODEL_TOKEN_LIMITS[modelName];
  }

  // Try partial match (e.g., "gpt-4" for "gpt-4-0125-preview")
  for (const [key, value] of Object.entries(MODEL_TOKEN_LIMITS)) {
    if (modelName.includes(key) && key !== 'default') {
      return value;
    }
  }

  // Default fallback
  return MODEL_TOKEN_LIMITS.default;
}

/**
 * Estimate token count using simple heuristics
 * Approximation: 1 token ≈ 4 characters (for English)
 * This is overly conservative to avoid OOM
 */
export function estimateTokenCount(text: string): number {
  // Count visible characters (exclude whitespace for rough estimate)
  const visibleChars = text.replace(/\s+/g, ' ').length;
  // Conservative estimate: 1 token per 3.5 chars
  return Math.ceil(visibleChars / 3.5);
}

/**
 * Estimate total tokens in a message
 */
export function estimateMessageTokens(message: Message): number {
  let tokens = 0;

  // Content tokens
  tokens += estimateTokenCount(message.content);

  // Tool calls tokens (if any)
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      tokens += estimateTokenCount(tc.name);
      tokens += estimateTokenCount(JSON.stringify(tc.arguments));
    }
  }

  // Tool results tokens (if any)
  if (message.tool_results) {
    for (const tr of message.tool_results) {
      tokens += estimateTokenCount(tr.output);
    }
  }

  // Overhead per message (~20 tokens for role and formatting)
  tokens += 20;

  return Math.max(tokens, 1);
}

/**
 * Estimate total tokens in a message list
 */
export function estimateContextTokens(messages: Message[]): number {
  let totalTokens = 0;

  for (const msg of messages) {
    totalTokens += estimateMessageTokens(msg);
  }

  // Add system message overhead (~50 tokens)
  totalTokens += 50;

  return totalTokens;
}

/**
 * Calculate context fill rate
 * @param messages - Message list
 * @param model - Model name
 * @returns fill rate between 0 and 1
 */
export function calculateContextFillRate(messages: Message[], model: string): number {
  const currentTokens = estimateContextTokens(messages);
  const maxTokens = getContextWindowSize(model);

  return Math.min(currentTokens / maxTokens, 1);
}

/**
 * Check if context is approaching limit
 * @param messages - Message list
 * @param model - Model name
 * @param threshold - Fill rate threshold (default 0.8 = 80%)
 * @returns true if context exceeds threshold
 */
export function shouldCompact(
  messages: Message[],
  model: string,
  threshold: number = 0.8,
): boolean {
  const fillRate = calculateContextFillRate(messages, model);
  return fillRate > threshold;
}

/**
 * Get diagnostic info about context usage
 */
export function getContextDiagnostics(
  messages: Message[],
  model: string,
): { currentTokens: number; maxTokens: number; fillRate: number; fillPercentage: string } {
  const currentTokens = estimateContextTokens(messages);
  const maxTokens = getContextWindowSize(model);
  const fillRate = currentTokens / maxTokens;

  return {
    currentTokens,
    maxTokens,
    fillRate,
    fillPercentage: `${(fillRate * 100).toFixed(2)}%`,
  };
}
