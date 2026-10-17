const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveSettings } = require('../src/settings.js');

describe('resolveSettings', () => {
  it('lets user overrides win over defaults', () => {
    assert.deepEqual(resolveSettings({ theme: 'dark' }), {
      theme: 'dark',
      pageSize: 20,
      notifications: true,
    });
  });

  it('returns the defaults when nothing is overridden', () => {
    assert.deepEqual(resolveSettings({}), { theme: 'light', pageSize: 20, notifications: true });
  });
});
