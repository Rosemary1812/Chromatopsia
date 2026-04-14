/**
 * Streaming Retry Handler
 * Implements exponential backoff + jitter for LLM streaming API calls
 *
 * Strategy:
 * - Max 3 retries
 * - Backoff: 1s, 4s, 16s (exponential 2^n)
 * - Jitter: ±25% random variance to avoid thundering herd
 * - Total worst-case: ~21 seconds
 */

export interface RetryConfig {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Calculate exponential backoff with jitter
 * @param attempt - 0-indexed attempt number
 * @param config - retry configuration
 * @returns delay in milliseconds
 */
export function calculateBackoffDelay(attempt: number, config: RetryConfig = {}): number {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Exponential: 1s, 2s, 4s, 8s, ...
  const exponentialDelay = cfg.initialDelayMs * Math.pow(2, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, cfg.maxDelayMs);

  // Add jitter: ±25%
  const jitterAmount = cappedDelay * 0.25;
  const jitter = (Math.random() - 0.5) * 2 * jitterAmount;

  return Math.max(cfg.initialDelayMs, Math.floor(cappedDelay + jitter));
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry handler with exponential backoff
 * @param fn - async function to retry
 * @param config - retry configuration
 * @returns result of fn
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {},
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < cfg.maxRetries - 1) {
        const delayMs = calculateBackoffDelay(attempt, config);
        await sleep(delayMs);
      }
    }
  }

  throw lastError || new Error('Retry exhausted');
}

/**
 * Retry handler for async generators (streaming)
 * Yields chunks from the generator, retrying if stream breaks
 */
export async function* retryStreamWithBackoff<T, TReturn = T>(
  fn: () => AsyncGenerator<T, TReturn, void>,
  config: RetryConfig = {},
): AsyncGenerator<T, TReturn, void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
    let generator: AsyncGenerator<T, TReturn, void> | null = null;

    try {
      generator = fn();

      let result = await generator.next();
      while (!result.done) {
        yield result.value;
        result = await generator.next();
      }

      // Success - return final value
      return result.value;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < cfg.maxRetries - 1) {
        const delayMs = calculateBackoffDelay(attempt, config);
        await sleep(delayMs);
      }
    }
  }

  throw lastError || new Error('Stream retry exhausted');
}
