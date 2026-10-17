const _ = require('lodash');

function inStock(products) {
  return _.where(products, { available: true });
}

function inStockCount(products) {
  return inStock(products).length;
}

module.exports = { inStock, inStockCount };
