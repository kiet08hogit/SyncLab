const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isoDay, longDate, receiptStamp } = require('../src/labels.js');
const { nextBusinessDay, daysUntil } = require('../src/ranges.js');

const friday = new Date(2024, 2, 1, 15, 7);

describe('labels', () => {
  it('formats an ISO day', () => {
    assert.equal(isoDay(friday), '2024-03-01');
  });

  it('formats a long date', () => {
    assert.equal(longDate(friday), 'Friday, March 1st 2024');
  });

  it('formats a receipt stamp', () => {
    assert.equal(receiptStamp(friday), '01/03/24 3:07 PM');
  });
});

describe('ranges', () => {
  it('skips the weekend', () => {
    assert.equal(isoDay(nextBusinessDay(friday)), '2024-03-04');
  });

  it('counts calendar days', () => {
    assert.equal(daysUntil(friday, new Date(2024, 2, 15)), 14);
  });
});
