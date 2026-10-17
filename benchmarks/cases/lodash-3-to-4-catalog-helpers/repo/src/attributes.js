const _ = require('lodash');

function attributeRows(product) {
  return _.pairs(product.attributes).map(([key, value]) => `${key}: ${value}`);
}

module.exports = { attributeRows };
