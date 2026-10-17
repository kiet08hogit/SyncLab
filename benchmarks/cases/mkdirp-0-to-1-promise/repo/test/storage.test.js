const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureDir, ensureDirSync, writeArtifact } = require('../src/storage.js');

describe('storage', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates nested directories', async () => {
    const dir = path.join(root, 'a', 'b', 'c');
    assert.equal(await ensureDir(dir), dir);
    assert.ok(fs.statSync(dir).isDirectory());
  });

  it('accepts a directory that already exists', async () => {
    await ensureDir(root);
    assert.ok(fs.statSync(root).isDirectory());
  });

  it('writes artifacts into fresh directories', async () => {
    const file = await writeArtifact(root, 'builds/42/report.txt', 'ok');
    assert.equal(fs.readFileSync(file, 'utf8'), 'ok');
  });

  it('creates directories synchronously', () => {
    const dir = ensureDirSync(path.join(root, 'sync', 'dir'));
    assert.ok(fs.statSync(dir).isDirectory());
  });
});
