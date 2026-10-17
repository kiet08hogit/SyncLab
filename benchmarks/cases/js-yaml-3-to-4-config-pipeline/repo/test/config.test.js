const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, loadManifests } = require('../src/load.js');
const { exportConfig } = require('../src/export.js');
const { parseStrict } = require('../src/strict.js');
const { formatFor } = require('../src/format.js');

describe('config pipeline', () => {
  it('loads a config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-'));
    const file = path.join(dir, 'service.yaml');
    fs.writeFileSync(file, 'name: api\nreplicas: 3\nports:\n  - 80\n  - 443\n');
    try {
      assert.deepEqual(loadConfig(file), { name: 'api', replicas: 3, ports: [80, 443] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports the file name for syntax errors', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-'));
    const file = path.join(dir, 'broken.yaml');
    fs.writeFileSync(file, 'name: [api\n');
    try {
      assert.throws(() => loadConfig(file), /broken\.yaml/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads every document of a multi-document stream', () => {
    const text = 'kind: Service\nname: api\n---\n---\nkind: Deployment\nname: api\n';
    assert.deepEqual(loadManifests(text), [
      { kind: 'Service', name: 'api' },
      { kind: 'Deployment', name: 'api' },
    ]);
  });

  it('exports configs with sorted keys', () => {
    assert.equal(exportConfig({ replicas: 2, name: 'web', env: { b: '2', a: '1' } }), 'env:\n  a: \'1\'\n  b: \'2\'\nname: web\nreplicas: 2\n');
  });

  it('parses strict documents with the JSON schema', () => {
    assert.deepEqual(parseStrict('enabled: true\ncount: 4\n'), { enabled: true, count: 4 });
  });

  it('detects the format from the extension', () => {
    assert.equal(formatFor('app.YML'), 'yaml');
    assert.equal(formatFor('app.json'), 'json');
  });
});
