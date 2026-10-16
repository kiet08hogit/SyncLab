const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { canManageBilling } = require('../src/permissions.js');

describe('permissions', () => {
  it('allows admins', () => {
    assert.equal(canManageBilling({ role: 'admin', grants: [] }), true);
  });

  it('allows users with an explicit grant', () => {
    assert.equal(canManageBilling({ role: 'member', grants: ['reports', 'billing'] }), true);
  });

  it('denies everyone else', () => {
    assert.equal(canManageBilling({ role: 'member', grants: ['reports'] }), false);
  });
});
