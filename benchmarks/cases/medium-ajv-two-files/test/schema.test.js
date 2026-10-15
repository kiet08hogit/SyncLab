const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { namePath } = require('../src/name.js');
const { agePath } = require('../src/age.js');
const { readyPath } = require('../src/ready.js');

describe('schemas', () => {
  it('names the name path', () => assert.equal(namePath({ name: 1 }), '/name'));
  it('names the age path', () => assert.equal(agePath({ age: 'x' }), '/age'));
  it('keeps the existing instancePath helper', () => assert.equal(readyPath({ ready: 'yes' }), '/ready'));
});
