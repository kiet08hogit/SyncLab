/**
 * Only transient model failures are worth retrying at the job level: the work
 * is still valid, the provider just cannot serve it right now. That is a rate
 * limit from a hosted provider, or a local Ollama server that is not running
 * yet. Everything else - a bad key, an unknown model, a malformed response -
 * repeats identically on a retry.
 */
export function isRetryableModelError(error: unknown): boolean {
  const candidate = error as { status?: unknown; code?: unknown; cause?: unknown } | null;

  if (candidate?.status === 429 || candidate?.code === 429) {
    return true;
  }

  // Node's fetch reports a refused connection as "fetch failed" and keeps the
  // socket error on cause.
  const cause = candidate?.cause as { code?: unknown } | undefined;

  if (cause?.code === 'ECONNREFUSED') {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);

  return /\b429\b|too many requests|resource[_ ]exhausted|rate limit|quota|ECONNREFUSED/i.test(
    message,
  );
}
