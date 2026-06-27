/**
 * Exponential backoff with full jitter.
 * Retries on throttling (429) and transient server errors (5xx).
 */

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 200;
const DEFAULT_MAX_DELAY_MS = 30_000;

interface BackoffOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

function isRetryable(error: unknown): boolean {
  if (error && typeof error === "object") {
    const err = error as { $metadata?: { httpStatusCode?: number }; name?: string };
    const status = err.$metadata?.httpStatusCode;
    if (status === 429 || (status && status >= 500)) return true;
    if (err.name === "ThrottlingException" || err.name === "TooManyRequestsException") return true;
    if (err.name === "ServiceUnavailableException") return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async function with exponential backoff + jitter.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  options: BackoffOptions = {},
): Promise<T> {
  const { maxRetries = DEFAULT_MAX_RETRIES, baseDelayMs = DEFAULT_BASE_DELAY_MS, maxDelayMs = DEFAULT_MAX_DELAY_MS } =
    options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryable(error)) {
        throw error;
      }
      // Full jitter: random between 0 and min(maxDelay, base * 2^attempt)
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
      const jitteredDelay = Math.random() * cappedDelay;
      await sleep(jitteredDelay);
    }
  }

  throw lastError;
}
