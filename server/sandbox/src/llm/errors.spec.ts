import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRateLimitError } from './errors.js';

describe('isRateLimitError', () => {
  it('recognises a numeric status on the error object', () => {
    assert.equal(isRateLimitError(Object.assign(new Error('nope'), { status: 429 })), true);
    assert.equal(isRateLimitError(Object.assign(new Error('nope'), { code: 429 })), true);
  });

  it('recognises the shapes Gemini reports quota exhaustion in', () => {
    assert.equal(isRateLimitError(new Error('429 Too Many Requests')), true);
    assert.equal(isRateLimitError(new Error('RESOURCE_EXHAUSTED: quota exceeded')), true);
    assert.equal(isRateLimitError(new Error('Rate limit reached for this model')), true);
  });

  it('treats failures that would repeat identically as permanent', () => {
    assert.equal(isRateLimitError(new Error('API key not valid')), false);
    assert.equal(isRateLimitError(Object.assign(new Error('bad request'), { status: 400 })), false);
    assert.equal(isRateLimitError(new Error('model not found')), false);
  });

  it('survives values that are not errors', () => {
    assert.equal(isRateLimitError(undefined), false);
    assert.equal(isRateLimitError(null), false);
    assert.equal(isRateLimitError('429 slow down'), true);
  });
});
