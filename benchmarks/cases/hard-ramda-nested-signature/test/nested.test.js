const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { search } = require('../src/search.js');
const { overlay } = require('../src/overlay.js');
const { config } = require('../src/config.js');
const { stable } = require('../src/stable.js');

describe('nested ramda', () => {
  it('searches names', () => {
    assert.equal(search([{ name: 'Ada' }]).matches('Ada'), true);
    assert.equal(search([{ name: 'Ada' }]).matches('Grace'), false);
  });
  it('overlays from left to right', () => {
    assert.deepEqual(overlay({ a: 1, b: 1 }, { b: 2 })({ b: 3, c: 4 }), { a: 1, b: 3, c: 4 });
  });
  it('builds config and checks flags', () => {
    const value = config({ host: 'local', port: 1 }, { port: 80 });
    assert.deepEqual(value.value(), { host: 'local', port: 80 });
    assert.equal(value.allows('read', ['read', 'write']), true);
  });
  it('keeps the migrated module', () => {
    const value = stable(['Ada'], { enabled: true });
    assert.equal(value.has('Ada'), true);
    assert.deepEqual(value.merged, { enabled: true });
  });
});
