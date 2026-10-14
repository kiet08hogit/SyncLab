const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { newId } = require('../src/ids.js');

describe('newId', () => {
  it('returns a uuid v4 string', () => {
    const id = newId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
