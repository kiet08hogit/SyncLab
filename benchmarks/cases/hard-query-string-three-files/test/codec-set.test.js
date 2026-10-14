const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readQuery } = require('../src/read.js');
const { roundTrip } = require('../src/codec.js');
const { nestedWrite } = require('../src/nested.js');
const { readyParse } = require('../src/ready.js');

describe('query codec set', () => {
  it('reads', () => assert.deepEqual(readQuery('a=1'), { a: '1' }));
  it('round trips', () => assert.equal(roundTrip('b=2'), 'b=2'));
  it('writes from a nested helper', () => assert.equal(nestedWrite({ c: '3' }), 'c=3'));
  it('keeps the migrated parser', () => assert.deepEqual(readyParse('d=4'), { d: '4' }));
});
