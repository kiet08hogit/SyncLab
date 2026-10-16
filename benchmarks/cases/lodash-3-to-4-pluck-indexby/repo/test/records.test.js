const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { recordNames } = require('../src/names.js');
const { byId } = require('../src/groups.js');
const { labels } = require('../src/labels.js');

const records = [
  { id: 'a', name: 'Ada', label: 'A' },
  { id: 'b', name: 'Grace', label: 'G' },
];

describe('records', () => {
  it('collects names', () => {
    assert.deepEqual(recordNames(records), ['Ada', 'Grace']);
  });

  it('indexes records by id', () => {
    assert.deepEqual(byId(records), {
      a: records[0],
      b: records[1],
    });
  });

  it('keeps the already-valid map helper', () => {
    assert.deepEqual(labels(records), ['A', 'G']);
  });
});
