const _ = require('lodash');

function receiptLine(item) {
  const name = _.padRight(_.trunc(item.name, 12), 12);
  const qty = _.padLeft(String(item.qty), 3);
  const total = _.padLeft((item.qty * item.price).toFixed(2), 8);
  return name + qty + total;
}

module.exports = { receiptLine };
