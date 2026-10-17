const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanWorkspace } = require('../src/cleanup.js');
const { resetCache } = require('../src/cache.js');
const { listTree } = require('../src/tree.js');

const files = [
  'build/app.js',
  'build/assets/logo.png',
  'src/index.js',
  'src/upload.tmp',
  'src/deep/nested/session.tmp',
  'notes.tmp',
  'notes.md',
  '.cache/old/entry.bin',
];

describe('workspace cleanup', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-'));
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), 'x');
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('removes build output and temporary files', async () => {
    await cleanWorkspace(root);
    assert.deepEqual(listTree(root), [
      '.cache/',
      '.cache/old/',
      '.cache/old/entry.bin',
      'notes.md',
      'src/',
      'src/deep/',
      'src/deep/nested/',
      'src/index.js',
    ]);
  });

  it('is safe to run on a clean workspace', async () => {
    await cleanWorkspace(root);
    await cleanWorkspace(root);
    assert.ok(fs.existsSync(path.join(root, 'src/index.js')));
  });

  it('resets the cache directory', () => {
    const dir = resetCache(root);
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});
