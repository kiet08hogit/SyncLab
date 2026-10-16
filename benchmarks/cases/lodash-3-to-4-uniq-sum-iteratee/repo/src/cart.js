const _ = require('lodash');

function distinctProducts(lines) {
  return _.uniq(lines, 'productId').map(function (line) {
    return line.productId;
  });
}

function itemCount(lines) {
  return _.sum(lines, 'quantity');
}

function subtotal(lines) {
  return _.sum(lines, function (line) {
    return line.quantity * line.unitPrice;
  });
}

module.exports = { distinctProducts, itemCount, subtotal };
