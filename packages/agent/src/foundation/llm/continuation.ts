/**
 * Truncation Recovery Handler
 *
 * When LLM output is truncated due to max_tokens or context window limits,
 * automatically issue a continuation request to complete the response.
 *
 * Detects:
 * - finish_reason === 'length' (Anthropic)
 * - finish_reason === 'length' (OpenAI)
 * - Stop text patterns that indicate truncation
 */

import type { LLMResponse, LLMProvider, Message } from '../types.js';

export interface ContinuationConfig {
  maxContinuations?: number;
  continuationPrompt?: string;
}

const DEFAULT_CONFIG: Required<ContinuationConfig> = {
  maxContinuations: 3,
  continuationPrompt: '请继续之前的回答，从中断处继续生成。不要重复已经生成的内容。',
};

/**
 * Check if LLM response was truncated
 */
export function isTruncated(response: LLMResponse): boolean {
  // Check content for truncation heuristics only
  // (most providers will properly set finish_reason to 'stop' or 'tool_use')
  const content = response.content.trim();

  if (!content) {
    return false;
  }

  // Unclosed code blocks
  const openCodeBlocks = (content.match(/```/g) || []).length;
  if (openCodeBlocks % 2 !== 0) {
    return true;
  }

  // Ends with common incomplete patterns
  const incompletePatterns = [
    /\s+[a-zA-Z0-9]{1,3}$/, // Single incomplete word
    /\.\.\.\s*$/, // Ellipsis at end
    /[a-zA-Z0-9]_$/, // Underscore at end (incomplete var name)
  ];

  if (incompletePatterns.some((p) => p.test(content))) {
    return true;
  }

  return false;
}

/**
 * Request continuation from LLM
 */
export async function requestContinuation(
  provider: LLMProvider,
  messages: Message[],
  previousResponse: string,
  config: ContinuationConfig = {},
): Promise<LLMResponse> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Append assistant's previous response and request continuation
  const continuationMessages: Message[] = [
    ...messages,
    { role: 'assistant', content: previousResponse },
    { role: 'user', content: cfg.continuationPrompt },
  ];

  return provider.chat(continuationMessages);
}

/**
 * Handle truncation recovery by attempting continuation
 */
export async function handleTruncation(
  provider: LLMProvider,
  messages: Message[],
  initialResponse: LLMResponse,
  config: ContinuationConfig = {},
): Promise<string> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!isTruncated(initialResponse)) {
    return initialResponse.content;
  }

  let accumulated = initialResponse.content;

  for (let i = 0; i < cfg.maxContinuations; i++) {
    try {
      const continuationResponse = await requestContinuation(
        provider,
        messages,
        accumulated,
        config,
      );

      accumulated += continuationResponse.content;

      // Stop if we got a natural completion
      if (continuationResponse.finish_reason === 'stop' && !isTruncated(continuationResponse)) {
        break;
      }
    } catch (err) {
      // If continuation fails, return what we have
      break;
    }
  }

  return accumulated;
}
