const fs = require('node:fs');
const path = require('node:path');
const rimraf = require('rimraf');

function resetCache(root) {
  const dir = path.join(root, '.cache');
  rimraf.sync(dir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { resetCache };
