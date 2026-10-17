const { addDays, differenceInCalendarDays, format, isBefore } = require('date-fns');

function dueDate(invoice) {
  return format(addDays(invoice.issuedOn, invoice.termsDays), 'YYYY-MM-DD');
}

function daysOverdue(invoice, today) {
  const due = addDays(invoice.issuedOn, invoice.termsDays);
  return isBefore(due, today) ? differenceInCalendarDays(today, due) : 0;
}

module.exports = { dueDate, daysOverdue };
