const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { itemsInAisle, findBySku } = require('../src/inventory.js');

const items = [
  { sku: 'BOLT-10', aisle: 4, active: true },
  { sku: 'NUT-08', aisle: 4, active: false },
  { sku: 'WASH-02', aisle: 7, active: true },
  { sku: 'SCREW-6', aisle: 4, active: true },
];

describe('inventory', () => {
  it('lists active items in an aisle', () => {
    assert.deepEqual(itemsInAisle(items, 4).map((i) => i.sku), ['BOLT-10', 'SCREW-6']);
  });

  it('finds an item by sku', () => {
    assert.equal(findBySku(items, 'WASH-02'), items[2]);
    assert.equal(findBySku(items, 'NOPE'), undefined);
  });
});
