const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readQuery } = require('../src/read.js');
const { normalize } = require('../src/codec.js');
const { linkBuilder } = require('../src/links.js');
const { utmSource } = require('../src/search-params.js');

describe('url helpers', () => {
  it('reads query values with booleans', () => {
    assert.deepEqual(readQuery('?draft=true&title=Hello'), { draft: true, title: 'Hello' });
  });

  it('normalizes a search string', () => {
    assert.equal(normalize('b=2&a=1&empty='), 'a=1&b=2');
  });

  it('builds links from a nested helper', () => {
    const links = linkBuilder('https://example.test');
    assert.equal(links.build('/posts', { page: 2, tag: null }), 'https://example.test/posts?page=2');
  });

  it('reads the utm source', () => {
    assert.equal(utmSource('https://example.test/?utm_source=mail'), 'mail');
  });
});
