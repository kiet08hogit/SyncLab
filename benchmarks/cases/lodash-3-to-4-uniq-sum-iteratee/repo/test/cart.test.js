const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { distinctProducts, itemCount, subtotal } = require('../src/cart.js');

const lines = [
  { productId: 'p1', quantity: 2, unitPrice: 3 },
  { productId: 'p2', quantity: 1, unitPrice: 10 },
  { productId: 'p1', quantity: 1, unitPrice: 3 },
];

describe('cart', () => {
  it('lists distinct products in order', () => {
    assert.deepEqual(distinctProducts(lines), ['p1', 'p2']);
  });

  it('counts items', () => {
    assert.equal(itemCount(lines), 4);
  });

  it('computes the subtotal', () => {
    assert.equal(subtotal(lines), 19);
  });
});
