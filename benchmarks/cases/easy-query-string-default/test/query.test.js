const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readQuery } = require('../src/query.js');

// query-string's parse returns a null-prototype object, which strict deepEqual
// tells apart from a literal, so compare its own properties.
describe('readQuery', () => {
  it('parses a query string', () => {
    assert.deepEqual({ ...readQuery('name=Ada&role=dev') }, { name: 'Ada', role: 'dev' });
  });
});
