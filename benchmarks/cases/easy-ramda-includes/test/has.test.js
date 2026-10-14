const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hasValue } = require('../src/has.js');

describe('hasValue', () => {
  it('reports whether the list includes the value', () => {
    assert.equal(hasValue(['a', 'b'], 'b'), true);
    assert.equal(hasValue(['a', 'b'], 'c'), false);
  });
});
