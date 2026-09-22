/**
 * A rate limit is the one model failure worth retrying at the job level: the
 * work is still valid, there is just no quota right now. Everything else -
 * a bad key, an unknown model, a malformed response - repeats identically on
 * a retry and only burns more quota.
 */
export function isRateLimitError(error: unknown): boolean {
  const candidate = error as { status?: unknown; code?: unknown } | null;

  if (candidate?.status === 429 || candidate?.code === 429) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);

  return /\b429\b|too many requests|resource[_ ]exhausted|rate limit|quota/i.test(message);
}
