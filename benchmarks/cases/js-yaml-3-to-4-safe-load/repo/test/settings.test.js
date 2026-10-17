const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseSettings, readSettings } = require('../src/settings.js');

describe('settings', () => {
  it('merges parsed values over the defaults', () => {
    const settings = parseSettings('port: 9000\nfeatures:\n  - search\n  - export\n');
    assert.deepEqual(settings, { port: 9000, host: 'localhost', features: ['search', 'export'] });
  });

  it('falls back to the defaults for an empty document', () => {
    assert.deepEqual(parseSettings(''), { port: 8080, host: 'localhost', features: [] });
  });

  it('reads settings from disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-'));
    const file = path.join(dir, 'app.yml');
    fs.writeFileSync(file, 'host: 0.0.0.0\n');
    try {
      assert.equal(readSettings(file).host, '0.0.0.0');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
