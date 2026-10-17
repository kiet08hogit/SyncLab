const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadSettings } = require('../src/settings.js');

describe('settings', () => {
  it('loads the bundled defaults', () => {
    assert.deepEqual(loadSettings(), {
      appName: 'Orders Service',
      port: 8080,
      brandColor: '#1f6feb',
      database: { password: 's3cr3t#2024' },
      supportChannel: '#help-orders',
    });
  });

  it('lets overrides win', () => {
    const settings = loadSettings({ PORT: '9090', DB_PASSWORD: 'local' });
    assert.equal(settings.port, 9090);
    assert.equal(settings.database.password, 'local');
  });
});
