const _ = require('lodash');

function itemsInAisle(items, aisle) {
  return _.filter(items, { aisle: aisle, active: true });
}

function findBySku(items, sku) {
  return _.find(items, { sku: sku });
}

module.exports = { itemsInAisle, findBySku };
