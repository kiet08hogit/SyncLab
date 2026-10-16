const _ = require('lodash');

function productNames(products) {
  return _.pluck(products, 'name');
}

module.exports = { productNames };
