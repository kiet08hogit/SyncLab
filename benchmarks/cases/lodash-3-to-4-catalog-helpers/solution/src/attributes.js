const _ = require('lodash');

function attributeRows(product) {
  return _.toPairs(product.attributes).map(([key, value]) => `${key}: ${value}`);
}

module.exports = { attributeRows };
