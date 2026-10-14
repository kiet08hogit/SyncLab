const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { emailPath } = require('../src/user.js');
const { skuPath } = require('../src/order.js');
const { cityPath } = require('../src/address.js');
const { readyPath } = require('../src/ready.js');

describe('validators', () => {
  it('reports email', () => assert.equal(emailPath({ email: 1 }), '/email'));
  it('reports sku', () => assert.equal(skuPath({ sku: 2 }), '/sku'));
  it('reports city', () => assert.equal(cityPath({ city: false }), '/city'));
  it('keeps instancePath', () => assert.equal(readyPath({ ready: 1 }), '/ready'));
});
