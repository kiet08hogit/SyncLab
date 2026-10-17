const fs = require('node:fs');
const path = require('node:path');
const { rimrafSync } = require('rimraf');

function resetCache(root) {
  const dir = path.join(root, '.cache');
  rimrafSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { resetCache };
