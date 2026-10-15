const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hasId } = require('../src/has.js');
const { tagSet } = require('../src/tags.js');
const { combine } = require('../src/combine.js');
const { withDefaults } = require('../src/prefs.js');
const { stable } = require('../src/stable.js');

describe('ramda bundle', () => {
  it('checks ids', () => assert.equal(hasId(['a'], 'a'), true));
  it('checks nested tags', () => assert.equal(tagSet(['red']).includesTag('red'), true));
  it('combines objects', () => assert.deepEqual(combine({ a: 1 }, { a: 2 }), { a: 2 }));
  it('applies defaults from the left', () => assert.deepEqual(withDefaults({ theme: 'dark', page: 1 }, { page: 3 }), { theme: 'dark', page: 3 }));
  it('keeps the already-migrated helper', () => {
    const value = stable(['ok'], { page: 2 });
    assert.equal(value.has('ok'), true);
    assert.deepEqual(value.merged, { on: true, page: 2 });
  });
});
