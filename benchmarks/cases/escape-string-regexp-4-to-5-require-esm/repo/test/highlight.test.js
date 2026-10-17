const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { highlight, countMatches } = require('../src/highlight.js');

describe('highlight', () => {
  it('wraps every case-insensitive match', () => {
    assert.equal(highlight('Node and node', 'node'), '<mark>Node</mark> and <mark>node</mark>');
  });

  it('treats regex characters in the term literally', () => {
    assert.equal(highlight('price: $5.00 (approx.)', '$5.00 (approx.)', 'b'), 'price: <b>$5.00 (approx.)</b>');
  });

  it('returns the text unchanged for an empty term', () => {
    assert.equal(highlight('hello', ''), 'hello');
  });

  it('counts literal matches', () => {
    assert.equal(countMatches('a+b a+b ab', 'a+b'), 2);
    assert.equal(countMatches('[x] [x] x', '[x]'), 2);
  });
});
