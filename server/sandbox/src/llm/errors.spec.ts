import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRetryableModelError } from './errors.js';

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

  it('recognises an Ollama server that is not running', () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 192.168.65.254:11434'), {
        code: 'ECONNREFUSED',
      }),
    });

    assert.equal(isRetryableModelError(refused), true);
    assert.equal(isRetryableModelError(new Error('connect ECONNREFUSED 127.0.0.1:11434')), true);
  });

  it('treats failures that would repeat identically as permanent', () => {
    assert.equal(isRetryableModelError(new Error('API key not valid')), false);
    assert.equal(isRetryableModelError(Object.assign(new Error('bad request'), { status: 400 })), false);
    assert.equal(isRetryableModelError(new Error('model not found')), false);
    assert.equal(
      isRetryableModelError(new Error('model "qwen2.5-coder:14b" not found, try pulling it first')),
      false,
    );
  });

  it('survives values that are not errors', () => {
    assert.equal(isRetryableModelError(undefined), false);
    assert.equal(isRetryableModelError(null), false);
    assert.equal(isRetryableModelError('429 slow down'), true);
  });
});
