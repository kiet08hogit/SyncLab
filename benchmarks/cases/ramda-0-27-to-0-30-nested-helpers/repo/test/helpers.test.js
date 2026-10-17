const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { searchIndex } = require('../src/search.js');
const { tagSet } = require('../src/tags.js');
const { overlay } = require('../src/overlay.js');
const { loadConfig } = require('../src/config.js');
const { featureFlags } = require('../src/feature-flags.js');
const { define } = require('../src/glossary.js');

describe('nested ramda helpers', () => {
  it('searches record names', () => {
    const index = searchIndex([{ name: 'Ada' }, { name: 'Grace' }]);
    assert.equal(index.matches('Grace'), true);
    assert.equal(index.matches('Linus'), false);
  });

  it('builds a tag set', () => {
    const tags = tagSet(['red', 'blue', 'red']);
    assert.equal(tags.size, 2);
    assert.equal(tags.has('blue'), true);
    assert.equal(tags.has('green'), false);
  });

  it('overlays layers from left to right', () => {
    assert.deepEqual(overlay({ a: 1, b: 1 }, { b: 2 })({ b: 3, c: 4 }), { a: 1, b: 3, c: 4 });
  });

  it('lets the environment override defaults', () => {
    const config = loadConfig({ host: 'localhost', port: 3000, flags: ['read'] }, { port: 8080 });
    assert.deepEqual(config.values(), { host: 'localhost', port: 8080, flags: ['read'] });
    assert.equal(config.allows('read'), true);
    assert.equal(config.allows('write'), false);
  });

  it('reads feature flags', () => {
    const flags = featureFlags(['beta'], { rollout: 50 });
    assert.equal(flags.isOn('beta'), true);
    assert.equal(flags.isOn('legacy'), false);
    assert.deepEqual(flags.settings, { rollout: 50 });
  });

  it('defines glossary terms', () => {
    assert.equal(define('tag'), 'A short label attached to a record.');
    assert.equal(define('missing'), null);
  });
});
