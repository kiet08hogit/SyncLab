const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { receiptLine } = require('../src/receipt.js');

describe('receipt', () => {
  it('formats a short item', () => {
    assert.equal(receiptLine({ name: 'Milk', qty: 2, price: 1.25 }), 'Milk          2    2.50');
  });

  it('shortens long item names', () => {
    assert.equal(receiptLine({ name: 'Organic Peanut Butter', qty: 1, price: 6.5 }), 'Organic P...  1    6.50');
  });
});
