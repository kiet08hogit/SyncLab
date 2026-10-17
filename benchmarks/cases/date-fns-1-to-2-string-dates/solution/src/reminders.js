const { addDays, formatDistance, parseISO } = require('date-fns');
const { dueDate, daysOverdue } = require('./invoices');
const { sumAmounts } = require('./totals');

function reminderLine(invoice, today) {
  const due = addDays(parseISO(invoice.issuedOn), invoice.termsDays);
  const when = formatDistance(due, parseISO(today), { addSuffix: true });
  return `${invoice.number} is due ${dueDate(invoice)} (${when})`;
}

function overdueSummary(invoices, today) {
  const late = invoices.filter((invoice) => daysOverdue(invoice, today) > 0);
  return { count: late.length, total: sumAmounts(late) };
}

module.exports = { reminderLine, overdueSummary };
