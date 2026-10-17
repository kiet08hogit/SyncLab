import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCart, addItem, removeItem, applyCoupon } from '../src/cart.js';

describe('cart', () => {
  it('adds and merges lines without mutating the previous cart', () => {
    const one = addItem(emptyCart, 'mug');
    const two = addItem(one, 'mug', 2);
    assert.deepEqual(one.lines, [{ sku: 'mug', quantity: 1 }]);
    assert.deepEqual(two.lines, [{ sku: 'mug', quantity: 3 }]);
    assert.notEqual(one, two);
  });

  it('removes a line', () => {
    const cart = removeItem(addItem(addItem(emptyCart, 'mug'), 'tee'), 'mug');
    assert.deepEqual(cart.lines, [{ sku: 'tee', quantity: 1 }]);
  });

  it('applies a coupon and keeps untouched parts shared', () => {
    const cart = addItem(emptyCart, 'mug');
    const discounted = applyCoupon(cart, 'spring10');
    assert.equal(discounted.coupon, 'SPRING10');
    assert.equal(discounted.lines, cart.lines);
  });
});
