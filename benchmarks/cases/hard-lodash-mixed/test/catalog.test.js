const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { names } = require('../src/names.js');
const { active } = require('../src/active.js');
const { findById } = require('../src/lookup.js');
const { entries } = require('../src/pairs.js');
const { titles } = require('../src/keep.js');

const items = [
  { id: 1, name: 'Ada', title: 'Engine', active: true },
  { id: 2, name: 'Grace', title: 'Compiler', active: false },
];

describe('catalog', () => {
  it('reads names', () => {
    assert.deepEqual(names(items), ['Ada', 'Grace']);
  });

  it('filters active items', () => {
    assert.deepEqual(active(items), [items[0]]);
  });

  it('finds one item by id', () => {
    assert.equal(findById(items, 2), items[1]);
  });

  it('turns an object into pairs', () => {
    assert.deepEqual(entries({ id: 1, name: 'Ada' }), [
      ['id', 1],
      ['name', 'Ada'],
    ]);
  });

  it('keeps the deep lodash/map helper', () => {
    assert.deepEqual(titles(items), ['Engine', 'Compiler']);
  });
});
