const _ = require('lodash');

function receiptLine(item) {
  const name = _.padEnd(_.truncate(item.name, { length: 12 }), 12);
  const qty = _.padStart(String(item.qty), 3);
  const total = _.padStart((item.qty * item.price).toFixed(2), 8);
  return name + qty + total;
}

module.exports = { receiptLine };
