const _ = require('lodash');

function bucketBySize(expenses, limits) {
  return _.groupBy(expenses, function (expense) {
    if (expense.amount >= this.large) return 'large';
    if (expense.amount >= this.medium) return 'medium';
    return 'small';
  }, limits);
}

module.exports = { bucketBySize };
