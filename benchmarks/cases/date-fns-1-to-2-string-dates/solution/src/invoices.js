const { addDays, differenceInCalendarDays, format, isBefore, parseISO } = require('date-fns');

function dueDate(invoice) {
  return format(addDays(parseISO(invoice.issuedOn), invoice.termsDays), 'yyyy-MM-dd');
}

function daysOverdue(invoice, today) {
  const due = addDays(parseISO(invoice.issuedOn), invoice.termsDays);
  const now = parseISO(today);
  return isBefore(due, now) ? differenceInCalendarDays(now, due) : 0;
}

module.exports = { dueDate, daysOverdue };
