const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findSources } = require('../src/sources.js');
const { readManifests } = require('../src/manifests.js');
const { splitPatterns } = require('../src/patterns.js');
const { workspaceReport } = require('../src/report.js');

const tree = {
  'packages/zeta/package.json': '{"name":"zeta","version":"2.0.0"}',
  'packages/zeta/index.js': '',
  'packages/zeta/lib/z.js': '',
  'packages/alpha/package.json': '{"name":"alpha","version":"1.0.0"}',
  'packages/alpha/index.js': '',
  'packages/mid/package.json': '{"name":"mid","version":"0.3.0"}',
  'packages/mid/src/b.js': '',
  'packages/mid/src/a.js': '',
  'scripts/build.js': '',
  'node_modules/dep/index.js': '',
  'dist/bundle.js': '',
  'README.md': '',
};

describe('workspace', () => {
  let root;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-'));
    for (const [file, contents] of Object.entries(tree)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), contents);
    }
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finds sources in sorted order, skipping build output', async () => {
    assert.deepEqual(await findSources(root), [
      'packages/alpha/index.js',
      'packages/mid/src/a.js',
      'packages/mid/src/b.js',
      'packages/zeta/index.js',
      'packages/zeta/lib/z.js',
      'scripts/build.js',
    ]);
  });

  it('reads package manifests in sorted order', () => {
    assert.deepEqual(readManifests(root), [
      { dir: 'packages/alpha', name: 'alpha', version: '1.0.0' },
      { dir: 'packages/mid', name: 'mid', version: '0.3.0' },
      { dir: 'packages/zeta', name: 'zeta', version: '2.0.0' },
    ]);
  });

  it('builds a workspace report', async () => {
    const report = await workspaceReport(root);
    assert.equal(report.totalFiles, 6);
    assert.deepEqual(
      report.packages.map((entry) => [entry.name, entry.files]),
      [['alpha', 1], ['mid', 2], ['zeta', 2]],
    );
  });

  it('separates literal paths from patterns', () => {
    assert.deepEqual(splitPatterns(['src/index.js', 'src/**/*.ts', 'lib/?.mjs']), {
      literal: ['src/index.js'],
      patterns: ['src/**/*.ts', 'lib/?.mjs'],
    });
  });
});
