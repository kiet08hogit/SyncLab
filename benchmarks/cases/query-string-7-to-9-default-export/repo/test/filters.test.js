const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFilters } = require('../src/filters.js');

describe('readFilters', () => {
  it('parses page and tags from the search string', () => {
    assert.deepEqual(readFilters('?page=3&tag=red,blue'), { page: 3, tags: ['red', 'blue'] });
  });

  it('falls back to defaults', () => {
    assert.deepEqual(readFilters(''), { page: 1, tags: [] });
  });
});
