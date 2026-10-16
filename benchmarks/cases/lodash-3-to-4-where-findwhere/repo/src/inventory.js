const _ = require('lodash');

function itemsInAisle(items, aisle) {
  return _.where(items, { aisle: aisle, active: true });
}

function findBySku(items, sku) {
  return _.findWhere(items, { sku: sku });
}

module.exports = { itemsInAisle, findBySku };
