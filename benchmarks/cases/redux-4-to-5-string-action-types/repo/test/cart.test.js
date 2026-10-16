const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createCart, cartTotal } = require('../src/cart.js');
const { addItem, removeItem, clear } = require('../src/actions.js');

describe('cart store', () => {
  it('adds and merges items', () => {
    const store = createCart();
    store.dispatch(addItem('tea', 4, 2));
    store.dispatch(addItem('tea', 4));
    store.dispatch(addItem('mug', 10));
    assert.deepEqual(store.getState().items, {
      tea: { price: 4, quantity: 3 },
      mug: { price: 10, quantity: 1 },
    });
    assert.equal(cartTotal(store.getState()), 22);
  });

  it('removes items and clears the cart', () => {
    const store = createCart();
    store.dispatch(addItem('tea', 4));
    store.dispatch(addItem('mug', 10));
    store.dispatch(removeItem('tea'));
    assert.deepEqual(Object.keys(store.getState().items), ['mug']);
    store.dispatch(clear());
    assert.equal(cartTotal(store.getState()), 0);
  });

  it('notifies subscribers', () => {
    const store = createCart();
    let calls = 0;
    store.subscribe(() => { calls += 1; });
    store.dispatch(addItem('tea', 4));
    assert.equal(calls, 1);
  });
});
