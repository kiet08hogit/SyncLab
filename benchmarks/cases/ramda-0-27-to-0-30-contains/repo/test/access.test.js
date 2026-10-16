const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { canEdit } = require('../src/access.js');

describe('canEdit', () => {
  it('allows editor roles', () => {
    assert.equal(canEdit({ role: 'admin' }), true);
    assert.equal(canEdit({ role: 'editor' }), true);
  });

  it('rejects other roles', () => {
    assert.equal(canEdit({ role: 'viewer' }), false);
  });
});
