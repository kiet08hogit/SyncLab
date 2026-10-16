const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readQuery } = require('../src/read.js');
const { roundTrip } = require('../src/codec.js');
const { nestedWrite } = require('../src/nested.js');
const { readyParse } = require('../src/ready.js');

// query-string's parse returns a null-prototype object, which strict deepEqual
// tells apart from a literal, so compare its own properties.
describe('query codec set', () => {
  it('reads', () => assert.deepEqual({ ...readQuery('a=1') }, { a: '1' }));
  it('round trips', () => assert.equal(roundTrip('b=2'), 'b=2'));
  it('writes from a nested helper', () => assert.equal(nestedWrite({ c: '3' }), 'c=3'));
  it('keeps the migrated parser', () => assert.deepEqual({ ...readyParse('d=4') }, { d: '4' }));
});
