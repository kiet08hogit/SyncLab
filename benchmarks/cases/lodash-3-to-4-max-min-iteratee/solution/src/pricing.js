const _ = require('lodash');

function priceRange(products) {
  const cheapest = _.minBy(products, 'price');
  const priciest = _.maxBy(products, 'price');
  return { low: cheapest.price, high: priciest.price };
}

function bestRated(products) {
  return _.maxBy(products, function (product) {
    return product.rating * Math.min(product.reviews, 50);
  }).name;
}

module.exports = { priceRange, bestRated };
