const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readSort } = require('../src/read.js');
const { withPage } = require('../src/links.js');
const { linkHelp } = require('../src/notes.js');

describe('query helpers', () => {
  it('reads the sort order', () => {
    assert.deepEqual(readSort('?sort=name&order=asc'), { sort: 'name', order: 'asc' });
    assert.deepEqual(readSort(''), { sort: 'created', order: 'desc' });
  });

  it('builds a page link that keeps other parameters', () => {
    assert.equal(withPage('?sort=name&page=1', 4), '?page=4&sort=name');
  });

  it('explains links', () => {
    assert.match(linkHelp(), /only replace the page/);
  });
});
