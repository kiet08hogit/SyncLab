const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { combine } = require('../src/combine.js');

describe('combine', () => {
  it('lets the right object override the left', () => {
    assert.deepEqual(combine({ a: 1, b: 1 }, { b: 2 }), { a: 1, b: 2 });
  });
});
