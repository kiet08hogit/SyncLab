const _ = require('lodash');

function titles(products) {
  return _.map(products, (product) => product.name.toUpperCase());
}

module.exports = { titles };
