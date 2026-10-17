const { format } = require('date-fns');

function isoDay(date) {
  return format(date, 'yyyy-MM-dd');
}

function longDate(date) {
  return format(date, 'EEEE, MMMM do yyyy');
}

function receiptStamp(date) {
  return format(date, 'dd/MM/yy h:mm a');
}

module.exports = { isoDay, longDate, receiptStamp };
