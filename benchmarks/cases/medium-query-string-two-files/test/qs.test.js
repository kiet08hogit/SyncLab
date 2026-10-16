const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readQuery } = require('../src/read.js');
const { writeQuery } = require('../src/write.js');

// query-string's parse returns a null-prototype object, which strict deepEqual
// tells apart from a literal, so compare its own properties.
describe('query-string', () => {
  it('parses', () => {
    assert.deepEqual({ ...readQuery('a=1') }, { a: '1' });
  });
  it('stringifies', () => {
    assert.equal(writeQuery({ a: '1' }), 'a=1');
  });
});
