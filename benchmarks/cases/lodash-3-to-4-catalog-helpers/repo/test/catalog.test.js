const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { productNames } = require('../src/names.js');
const { inStock, inStockCount } = require('../src/stock.js');
const { findBySku } = require('../src/lookup.js');
const { attributeRows } = require('../src/attributes.js');
const { titles } = require('../src/titles.js');
const { releaseNote } = require('../src/changelog.js');

const products = [
  { sku: 'A-1', name: 'Lamp', available: true, attributes: { color: 'red', watts: 40 } },
  { sku: 'B-2', name: 'Desk', available: false, attributes: { wood: 'oak' } },
  { sku: 'C-3', name: 'Chair', available: true, attributes: {} },
];

describe('catalog', () => {
  it('lists product names', () => {
    assert.deepEqual(productNames(products), ['Lamp', 'Desk', 'Chair']);
  });

  it('keeps only available products', () => {
    assert.deepEqual(inStock(products), [products[0], products[2]]);
    assert.equal(inStockCount(products), 2);
  });

  it('finds a product by sku', () => {
    assert.equal(findBySku(products, 'B-2'), products[1]);
    assert.equal(findBySku(products, 'Z-9'), undefined);
  });

  it('formats attribute rows', () => {
    assert.deepEqual(attributeRows(products[0]), ['color: red', 'watts: 40']);
    assert.deepEqual(attributeRows(products[2]), []);
  });

  it('builds display titles', () => {
    assert.deepEqual(titles(products), ['LAMP', 'DESK', 'CHAIR']);
  });

  it('writes the release note', () => {
    assert.match(releaseNote('2.1'), /^Catalog 2\.1:/);
  });
});
