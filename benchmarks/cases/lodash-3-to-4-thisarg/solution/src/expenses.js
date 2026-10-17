const _ = require('lodash');

function bucketBySize(expenses, limits) {
  return _.groupBy(expenses, function (expense) {
    if (expense.amount >= limits.large) return 'large';
    if (expense.amount >= limits.medium) return 'medium';
    return 'small';
  });
}

module.exports = { bucketBySize };
