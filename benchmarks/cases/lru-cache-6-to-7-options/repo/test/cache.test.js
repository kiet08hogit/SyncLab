const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionStore } = require('../src/sessions.js');
const { createResponseCache } = require('../src/responses.js');

describe('session store', () => {
  it('keeps the most recently used sessions', () => {
    const store = createSessionStore(2);
    store.save('a', { user: 1 });
    store.save('b', { user: 2 });
    store.load('a');
    store.save('c', { user: 3 });
    assert.equal(store.load('b'), undefined);
    assert.deepEqual(store.activeIds(), ['c', 'a']);
  });

  it('ends and clears sessions', () => {
    const store = createSessionStore(5);
    store.save('a', {});
    store.save('b', {});
    store.end('a');
    assert.deepEqual(store.activeIds(), ['b']);
    store.clear();
    assert.deepEqual(store.activeIds(), []);
  });
});

describe('response cache', () => {
  it('evicts old responses once the byte budget is exceeded', () => {
    const cache = createResponseCache({ maxBytes: 10, maxAgeMs: 60_000 });
    cache.store('/a', 'aaaa');
    cache.store('/b', 'bbbb');
    assert.equal(cache.bytesUsed(), 8);
    cache.store('/c', 'cccccc');
    assert.equal(cache.lookup('/a'), undefined);
    assert.equal(cache.lookup('/b'), 'bbbb');
    assert.equal(cache.lookup('/c'), 'cccccc');
    assert.equal(cache.bytesUsed(), 10);
  });
});
