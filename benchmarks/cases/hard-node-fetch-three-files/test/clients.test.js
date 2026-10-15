const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { apiFetch } = require('../src/api.js');
const { retryFetch } = require('../src/retry.js');
const { nestedFetch } = require('../src/nested.js');
const { readyFetch } = require('../src/ready.js');

describe('clients', () => {
  it('api', () => assert.equal(typeof apiFetch(), 'function'));
  it('retry', () => assert.equal(typeof retryFetch(), 'function'));
  it('nested', () => assert.equal(typeof nestedFetch(), 'function'));
  it('ready', () => assert.equal(typeof readyFetch(), 'function'));
});
