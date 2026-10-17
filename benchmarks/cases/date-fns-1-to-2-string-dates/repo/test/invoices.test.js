const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { dueDate, daysOverdue } = require('../src/invoices.js');
const { reminderLine, overdueSummary } = require('../src/reminders.js');

const invoices = [
  { number: 'INV-1', issuedOn: '2024-01-10', termsDays: 30, amount: 120 },
  { number: 'INV-2', issuedOn: '2024-02-20', termsDays: 14, amount: 80 },
  { number: 'INV-3', issuedOn: '2024-03-01', termsDays: 30, amount: 45 },
];
const today = '2024-03-15';

describe('invoices', () => {
  it('computes the due date', () => {
    assert.equal(dueDate(invoices[0]), '2024-02-09');
  });

  it('counts days overdue', () => {
    assert.deepEqual(invoices.map((invoice) => daysOverdue(invoice, today)), [35, 10, 0]);
  });

  it('summarises overdue invoices', () => {
    assert.deepEqual(overdueSummary(invoices, '2024-03-20'), { count: 2, total: 200 });
  });
});

describe('reminders', () => {
  it('describes an upcoming due date', () => {
    assert.equal(reminderLine(invoices[2], today), 'INV-3 is due 2024-03-31 (in 16 days)');
  });

  it('describes a past due date', () => {
    assert.equal(reminderLine(invoices[0], today), 'INV-1 is due 2024-02-09 (about 1 month ago)');
  });
});
