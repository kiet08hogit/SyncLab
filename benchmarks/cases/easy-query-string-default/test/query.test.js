const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readQuery } = require('../src/query.js');

describe('readQuery', () => {
  it('parses a query string', () => {
    assert.deepEqual(readQuery('name=Ada&role=dev'), { name: 'Ada', role: 'dev' });
  });
});
