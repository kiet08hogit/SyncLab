const { addDays, distanceInWords } = require('date-fns');
const { dueDate, daysOverdue } = require('./invoices');
const { sumAmounts } = require('./totals');

function reminderLine(invoice, today) {
  const due = addDays(invoice.issuedOn, invoice.termsDays);
  const when = distanceInWords(today, due, { addSuffix: true });
  return `${invoice.number} is due ${dueDate(invoice)} (${when})`;
}

function overdueSummary(invoices, today) {
  const late = invoices.filter((invoice) => daysOverdue(invoice, today) > 0);
  return { count: late.length, total: sumAmounts(late) };
}

module.exports = { reminderLine, overdueSummary };
