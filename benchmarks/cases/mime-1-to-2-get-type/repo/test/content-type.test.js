const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { contentTypeFor, downloadName } = require('../src/content-type.js');

describe('content types', () => {
  it('detects binary types', () => {
    assert.equal(contentTypeFor('reports/q3.PDF'), 'application/pdf');
    assert.equal(contentTypeFor('logo.png'), 'image/png');
  });

  it('adds a charset to text types', () => {
    assert.equal(contentTypeFor('index.html'), 'text/html; charset=utf-8');
    assert.equal(contentTypeFor('data.json'), 'application/json; charset=utf-8');
  });

  it('serves unknown files as a generic binary', () => {
    assert.equal(contentTypeFor('LICENSE'), 'application/octet-stream');
  });

  it('names downloads after their type', () => {
    assert.equal(downloadName('export', 'text/csv'), 'export.csv');
    assert.equal(downloadName('summary.txt', 'application/json'), 'summary.json');
  });
});
