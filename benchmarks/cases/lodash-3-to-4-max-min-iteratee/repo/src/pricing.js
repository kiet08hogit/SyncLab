const _ = require('lodash');

function priceRange(products) {
  const cheapest = _.min(products, 'price');
  const priciest = _.max(products, 'price');
  return { low: cheapest.price, high: priciest.price };
}

function bestRated(products) {
  return _.max(products, function (product) {
    return product.rating * Math.min(product.reviews, 50);
  }).name;
}

module.exports = { priceRange, bestRated };
