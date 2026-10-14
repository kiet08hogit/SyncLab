const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getFetch } = require('../src/client.js');

describe('getFetch', () => {
  it('returns the fetch function', () => {
    assert.equal(typeof getFetch(), 'function');
  });
});
