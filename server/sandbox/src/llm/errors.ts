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
 * or a network failure on the way to the provider. Everything else - a bad
 * key, an unknown model, a malformed response - repeats identically on a retry.
 */
/** Socket failures that a later attempt can get past. */
const TRANSIENT_SOCKET_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE']);

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

  // The Anthropic SDK wraps a failed request in its own connection errors.
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') {
    return true;
  }

  // Node's fetch reports a network failure as "fetch failed" and keeps the
  // socket error on cause, which an SDK may wrap once more.
  let cause: unknown = candidate?.cause;
  for (let depth = 0; cause && depth < 3; depth++) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSIENT_SOCKET_ERRORS.has(code)) {
      return true;
    }
    cause = (cause as { cause?: unknown }).cause;
  }

  const message = error instanceof Error ? error.message : String(error);

  return /\b429\b|too many requests|resource[_ ]exhausted|rate limit|quota|overloaded_error|ECONNREFUSED/i.test(
    message,
  );
}
