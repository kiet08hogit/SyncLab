const _ = require('lodash');

function productNames(products) {
  return _.map(products, 'name');
}

module.exports = { productNames };
