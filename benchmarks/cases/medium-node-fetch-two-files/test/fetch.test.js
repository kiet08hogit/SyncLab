const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { apiFetch } = require('../src/api.js');
const { retryFetch } = require('../src/retry.js');
const { readyFetch } = require('../src/ready.js');

describe('fetch bindings', () => {
  it('exposes api fetch', () => assert.equal(typeof apiFetch(), 'function'));
  it('exposes retry fetch', () => assert.equal(typeof retryFetch(), 'function'));
  it('keeps the existing default binding', () => assert.equal(typeof readyFetch(), 'function'));
});
