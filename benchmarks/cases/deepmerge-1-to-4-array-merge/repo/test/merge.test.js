const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { defaults, resolveConfig } = require('../src/config.js');
const { applyColumnOverrides } = require('../src/table.js');

describe('config layers', () => {
  it('returns the defaults without layers', () => {
    assert.deepEqual(resolveConfig(), defaults);
  });

  it('adds new list entries without duplicating existing ones', () => {
    const config = resolveConfig(
      { server: { hosts: ['localhost', 'api.local'] }, features: ['search', 'export'] },
      { features: ['export', 'billing'] },
    );
    assert.deepEqual(config.server, { port: 3000, hosts: ['localhost', 'api.local'] });
    assert.deepEqual(config.features, ['search', 'export', 'billing']);
  });

  it('merges log targets position by position', () => {
    const config = resolveConfig({ logging: { level: 'debug', targets: [{ color: false }] } });
    assert.deepEqual(config.logging, { level: 'debug', targets: [{ type: 'console', color: false }] });
  });

  it('does not mutate the defaults', () => {
    resolveConfig({ features: ['other'] });
    assert.deepEqual(defaults.features, ['search']);
  });
});

describe('column overrides', () => {
  it('applies overrides to the column at the same position', () => {
    const columns = [
      { key: 'id', label: 'ID', width: 80 },
      { key: 'name', label: 'Name', width: 200 },
    ];
    assert.deepEqual(applyColumnOverrides(columns, [{}, { width: 320, sortable: true }]), [
      { key: 'id', label: 'ID', width: 80 },
      { key: 'name', label: 'Name', width: 320, sortable: true },
    ]);
  });
});
