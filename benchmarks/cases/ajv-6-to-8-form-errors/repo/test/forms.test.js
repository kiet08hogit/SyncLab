const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { userErrorPaths } = require('../src/user.js');
const { orderProblems } = require('../src/order.js');
const { addressFieldErrors } = require('../src/address.js');
const { missingFields } = require('../src/required.js');
const { validationHelp } = require('../src/help.js');

describe('form validators', () => {
  it('reports the user field path', () => {
    assert.deepEqual(userErrorPaths({ email: 42 }), ['/email']);
    assert.deepEqual(userErrorPaths({ email: 'ada@example.com' }), []);
  });

  it('reports nested order line paths', () => {
    assert.deepEqual(orderProblems({ sku: 7, lines: [{ qty: 1 }, { qty: 0 }] }), [
      '/sku type',
      '/lines/1/qty minimum',
    ]);
    assert.deepEqual(orderProblems({ sku: 'A-1', lines: [] }), []);
  });

  it('reports the first address error', () => {
    assert.deepEqual(addressFieldErrors({ city: 'Paris', zip: 'abc' }), { field: '/zip', rule: 'pattern' });
    assert.equal(addressFieldErrors({ city: 'Paris', zip: '75001' }), null);
  });

  it('lists missing required fields', () => {
    assert.deepEqual(missingFields({ name: 'Ada' }), ['email']);
    assert.deepEqual(missingFields({}), ['name', 'email']);
  });

  it('explains validation', () => {
    assert.match(validationHelp(), /highlighted fields/);
  });
});
