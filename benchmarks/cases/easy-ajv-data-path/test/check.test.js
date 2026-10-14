const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { nameErrorPath } = require('../src/check.js');

describe('nameErrorPath', () => {
  it('points at the name property', () => {
    assert.equal(nameErrorPath({ name: 1 }), '/name');
  });
});
