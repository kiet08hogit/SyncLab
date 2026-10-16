const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toHeaderName, toHeaders } = require('../src/headers.js');
const { columnName } = require('../src/columns.js');

describe('headers', () => {
  it('turns option keys into header names', () => {
    assert.equal(toHeaderName('contentType'), 'Content-Type');
    assert.equal(toHeaderName('cacheControl'), 'Cache-Control');
  });

  it('builds a header map', () => {
    assert.deepEqual(toHeaders({ accept: 'text/html', requestId: 42 }), {
      Accept: 'text/html',
      'Request-Id': '42',
    });
  });

  it('keeps snake case column names', () => {
    assert.equal(columnName('createdAt'), 'created_at');
  });
});
