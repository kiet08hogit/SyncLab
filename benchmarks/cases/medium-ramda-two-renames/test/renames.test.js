const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hasValue } = require('../src/has.js');
const { combine } = require('../src/combine.js');
const { hasLabel } = require('../src/already.js');

describe('renames', () => {
  it('checks membership', () => {
    assert.equal(hasValue([1, 2], 2), true);
  });
  it('merges with right-hand precedence', () => {
    assert.deepEqual(combine({ a: 1, b: 1 }, { b: 9 }), { a: 1, b: 9 });
  });
  it('keeps the existing includes helper', () => {
    assert.equal(hasLabel(['a'], 'a'), true);
  });
});
