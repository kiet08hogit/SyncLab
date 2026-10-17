const { format } = require('date-fns');

function isoDay(date) {
  return format(date, 'YYYY-MM-DD');
}

function longDate(date) {
  return format(date, 'dddd, MMMM Do YYYY');
}

function receiptStamp(date) {
  return format(date, 'DD/MM/YY h:mm A');
}

module.exports = { isoDay, longDate, receiptStamp };
