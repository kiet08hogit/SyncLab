const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createOrder } = require('../src/orders.js');

describe('orders', () => {
  it('creates an order with a prefixed id', () => {
    const order = createOrder('cus_1', [{ price: 5, quantity: 2 }, { price: 3, quantity: 1 }]);
    assert.match(order.id, /^ord_[A-Za-z0-9_-]{21}$/);
    assert.equal(order.customerId, 'cus_1');
    assert.equal(order.total, 13);
  });

  it('gives every order a unique id', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createOrder('cus_1', []).id));
    assert.equal(ids.size, 200);
  });
});
