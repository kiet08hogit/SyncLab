const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { nested } = require('../src/membership.js');

describe('nested membership', () => {
  it('checks a value through the nested helper', () => {
    assert.equal(nested(['Ada', 'Grace']).has('Grace'), true);
    assert.equal(nested(['Ada']).has('Grace'), false);
  });
});
