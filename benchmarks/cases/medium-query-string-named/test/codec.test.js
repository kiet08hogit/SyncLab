const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { roundTrip } = require('../src/codec.js');

describe('roundTrip', () => {
  it('parses and stringifies a single field', () => {
    assert.equal(roundTrip('name=Ada'), 'name=Ada');
  });
});
