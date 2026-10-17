const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { checkOrder } = require('../src/orders.js');

describe('checkOrder', () => {
  it('accepts a valid order with default shipping', () => {
    assert.deepEqual(checkOrder({ sku: 'MUG-01', quantity: 2 }), {
      accepted: true,
      order: { sku: 'MUG-01', quantity: 2, shipping: 'standard' },
    });
  });

  it('maps every problem to a stable code', () => {
    assert.deepEqual(checkOrder({ sku: '', quantity: 0, shipping: 'drone' }), {
      accepted: false,
      problems: [
        { field: 'sku', code: 'EMPTY_FIELD' },
        { field: 'quantity', code: 'TOO_SMALL' },
        { field: 'shipping', code: 'UNSUPPORTED_VALUE' },
      ],
    });
  });

  it('reports missing and oversized fields', () => {
    assert.deepEqual(checkOrder({ quantity: 'lots', note: 'x'.repeat(141) }), {
      accepted: false,
      problems: [
        { field: 'sku', code: 'MISSING_FIELD' },
        { field: 'quantity', code: 'NOT_A_NUMBER' },
        { field: 'note', code: 'TOO_LONG' },
      ],
    });
  });
});
