const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseContacts } = require('../src/contacts.js');
const { parseOrders } = require('../src/orders.js');
const { describeImportError } = require('../src/errors.js');

describe('contacts import', () => {
  it('normalizes headers and skips blank and broken lines', () => {
    const text = [
      ' Name , Email ',
      'Ada Lovelace, ada@example.com ',
      '',
      'broken line without enough columns',
      'Grace Hopper,grace@example.com',
      'No Email,',
    ].join('\n');
    assert.deepEqual(parseContacts(text), [
      { name: 'Ada Lovelace', email: 'ada@example.com' },
      { name: 'Grace Hopper', email: 'grace@example.com' },
    ]);
  });
});

describe('orders import', () => {
  it('casts numbers and computes totals', async () => {
    const rows = await parseOrders('sku;quantity;price\nA-1;2;9.5\nB-7;1;20\n');
    assert.deepEqual(rows, [
      { sku: 'A-1', quantity: 2, price: 9.5, total: 19 },
      { sku: 'B-7', quantity: 1, price: 20, total: 20 },
    ]);
  });

  it('reports malformed files', async () => {
    await assert.rejects(parseOrders('sku;quantity\n"A-1;2\n'), (error) => {
      assert.match(describeImportError(error), /^Malformed file \(CSV_/);
      return true;
    });
  });

  it('describes unrelated errors generically', () => {
    assert.equal(describeImportError(new Error('disk full')), 'Import failed');
  });
});
