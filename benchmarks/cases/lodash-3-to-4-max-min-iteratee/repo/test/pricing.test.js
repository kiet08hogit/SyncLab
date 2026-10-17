const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { priceRange, bestRated } = require('../src/pricing.js');

const products = [
  { name: 'Kettle', price: 39, rating: 4.1, reviews: 120 },
  { name: 'Toaster', price: 25, rating: 4.8, reviews: 12 },
  { name: 'Blender', price: 89, rating: 4.5, reviews: 80 },
  { name: 'Grinder', price: 54, rating: 3.9, reviews: 300 },
];

describe('pricing', () => {
  it('reports the price range', () => {
    assert.deepEqual(priceRange(products), { low: 25, high: 89 });
  });

  it('picks the best rated product weighted by review count', () => {
    assert.equal(bestRated(products), 'Blender');
  });
});
