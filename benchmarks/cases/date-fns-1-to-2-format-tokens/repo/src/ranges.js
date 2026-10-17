const { addDays, differenceInCalendarDays, isWeekend } = require('date-fns');

function nextBusinessDay(date) {
  let next = addDays(date, 1);
  while (isWeekend(next)) {
    next = addDays(next, 1);
  }
  return next;
}

function daysUntil(from, to) {
  return differenceInCalendarDays(to, from);
}

module.exports = { nextBusinessDay, daysUntil };
