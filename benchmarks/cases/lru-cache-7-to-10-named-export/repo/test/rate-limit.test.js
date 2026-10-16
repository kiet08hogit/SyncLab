const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../src/rate-limit.js');

describe('rate limiter', () => {
  it('allows requests up to the limit', () => {
    const allow = createRateLimiter({ limit: 2, windowMs: 60_000 });
    assert.equal(allow('10.0.0.1'), true);
    assert.equal(allow('10.0.0.1'), true);
    assert.equal(allow('10.0.0.1'), false);
  });

  it('tracks each client separately', () => {
    const allow = createRateLimiter({ limit: 1, windowMs: 60_000 });
    assert.equal(allow('a'), true);
    assert.equal(allow('b'), true);
    assert.equal(allow('a'), false);
  });

  it('forgets the oldest client once full', () => {
    const allow = createRateLimiter({ limit: 1, windowMs: 60_000, maxClients: 2 });
    allow('a');
    allow('b');
    allow('c');
    assert.equal(allow('a'), true);
  });
});
