/**
 * A failure the refactor chain raises itself about a file or a reply. It says
 * nothing about the provider's availability, and its message can carry text
 * from the repository, so it is never read for retry hints.
 */
export class PermanentModelError extends Error {}

/**
 * Only transient model failures are worth retrying at the job level: the work
 * is still valid, the provider just cannot serve it right now. That is a rate
 * limit from a hosted provider, Anthropic reporting itself overloaded (529),
 * or a local Ollama server that is not running yet. Everything else - a bad key, an unknown model, a malformed response -
 * repeats identically on a retry.
 */
export function isRetryableModelError(error: unknown): boolean {
  if (error instanceof PermanentModelError) {
    return false;
  }

  const candidate = error as { status?: unknown; code?: unknown; cause?: unknown } | null;

  if (
    candidate?.status === 429 ||
    candidate?.code === 429 ||
    candidate?.status === 529
  ) {
    return true;
  }

  // Node's fetch reports a refused connection as "fetch failed" and keeps the
  // socket error on cause.
  const cause = candidate?.cause as { code?: unknown } | undefined;

  if (cause?.code === 'ECONNREFUSED') {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);

  return /\b429\b|too many requests|resource[_ ]exhausted|rate limit|quota|overloaded_error|ECONNREFUSED/i.test(
    message,
  );
}
