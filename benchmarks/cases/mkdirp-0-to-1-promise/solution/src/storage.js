const fs = require('node:fs');
const path = require('node:path');
const mkdirp = require('mkdirp');

async function ensureDir(dir) {
  await mkdirp(dir, { mode: 0o755 });
  return dir;
}

async function writeArtifact(root, relativePath, contents) {
  const file = path.join(root, relativePath);
  await ensureDir(path.dirname(file));
  await fs.promises.writeFile(file, contents);
  return file;
}

function ensureDirSync(dir) {
  mkdirp.sync(dir, { mode: 0o755 });
  return dir;
}

module.exports = { ensureDir, ensureDirSync, writeArtifact };
