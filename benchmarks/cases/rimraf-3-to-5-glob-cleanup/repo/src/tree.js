const fs = require('node:fs');
const path = require('node:path');

function listTree(root, dir = '') {
  const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  return entries
    .flatMap((entry) => {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      return entry.isDirectory() ? [`${rel}/`, ...listTree(root, rel)] : [rel];
    })
    .sort();
}

module.exports = { listTree };
