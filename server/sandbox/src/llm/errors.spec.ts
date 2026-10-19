import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRetryableModelError, PermanentModelError } from './errors.js';

describe('isRetryableModelError', () => {
  it('recognises a numeric status on the error object', () => {
    assert.equal(isRetryableModelError(Object.assign(new Error('nope'), { status: 429 })), true);
    assert.equal(isRetryableModelError(Object.assign(new Error('nope'), { code: 429 })), true);
  });

  it('recognises the shapes Gemini reports quota exhaustion in', () => {
    assert.equal(isRetryableModelError(new Error('429 Too Many Requests')), true);
    assert.equal(isRetryableModelError(new Error('RESOURCE_EXHAUSTED: quota exceeded')), true);
    assert.equal(isRetryableModelError(new Error('Rate limit reached for this model')), true);
  });

  it('recognises Anthropic reporting itself overloaded', () => {
    assert.equal(isRetryableModelError(Object.assign(new Error('Overloaded'), { status: 529 })), true);
    assert.equal(
      isRetryableModelError(new Error('529 {"type":"error","error":{"type":"overloaded_error"}}')),
      true,
    );
  });

  it('recognises a refused connection', () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 142.250.80.10:443'), {
        code: 'ECONNREFUSED',
      }),
    });

    assert.equal(isRetryableModelError(refused), true);
    assert.equal(isRetryableModelError(new Error('connect ECONNREFUSED 142.250.80.10:443')), true);
  });

  it('recognises a network failure wrapped by the Anthropic SDK', () => {
    const socket = Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' });
    const fetchFailed = Object.assign(new TypeError('fetch failed'), { cause: socket });
    const wrapped = Object.assign(new Error('Connection error.'), {
      name: 'APIConnectionError',
      cause: fetchFailed,
    });

    assert.equal(isRetryableModelError(wrapped), true);
    assert.equal(
      isRetryableModelError(Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' })),
      true,
    );
    // Found through the cause chain even without the SDK's error name.
    assert.equal(isRetryableModelError(Object.assign(new Error('wrapped'), { cause: fetchFailed })), true);
  });

  it('treats failures that would repeat identically as permanent', () => {
    assert.equal(isRetryableModelError(new Error('API key not valid')), false);
    assert.equal(isRetryableModelError(Object.assign(new Error('bad request'), { status: 400 })), false);
    assert.equal(isRetryableModelError(new Error('model not found')), false);
  });

  it('never retries a failure the chain raised itself, whatever its text says', () => {
    assert.equal(
      isRetryableModelError(new PermanentModelError('src/billing/quota.ts hit a 429 rate limit')),
      false,
    );
  });

  it('survives values that are not errors', () => {
    assert.equal(isRetryableModelError(undefined), false);
    assert.equal(isRetryableModelError(null), false);
    assert.equal(isRetryableModelError('429 slow down'), true);
  });
});
