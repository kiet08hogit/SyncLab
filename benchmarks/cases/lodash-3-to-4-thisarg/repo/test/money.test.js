const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Converter } = require('../src/currency.js');
const { bucketBySize } = require('../src/expenses.js');

const converter = new Converter({ USD: 1, EUR: 1.1, GBP: 1.25 });
const amounts = [
  { value: 10, currency: 'EUR' },
  { value: 20, currency: 'GBP' },
  { value: 5, currency: 'USD' },
];

describe('money', () => {
  it('converts each amount to USD', () => {
    assert.deepEqual(converter.toUsd(amounts), [11, 25, 5]);
  });

  it('totals amounts in USD', () => {
    assert.equal(converter.totalUsd(amounts), 41);
  });

  it('buckets expenses by size', () => {
    const expenses = [{ amount: 5 }, { amount: 150 }, { amount: 1200 }, { amount: 40 }];
    assert.deepEqual(bucketBySize(expenses, { medium: 100, large: 1000 }), {
      small: [{ amount: 5 }, { amount: 40 }],
      medium: [{ amount: 150 }],
      large: [{ amount: 1200 }],
    });
  });
});
