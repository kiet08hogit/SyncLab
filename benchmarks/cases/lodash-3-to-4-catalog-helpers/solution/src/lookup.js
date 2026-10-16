const _ = require('lodash');

function findBySku(products, sku) {
  return _.find(products, { sku });
}

module.exports = { findBySku };
