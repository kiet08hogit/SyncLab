const _ = require('lodash');

function findBySku(products, sku) {
  return _.findWhere(products, { sku });
}

module.exports = { findBySku };
