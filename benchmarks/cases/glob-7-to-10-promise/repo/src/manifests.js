const fs = require('node:fs');
const path = require('node:path');
const glob = require('glob');

function readManifests(cwd) {
  return glob.sync('packages/*/package.json', { cwd }).map((file) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, file), 'utf8'));
    return { dir: path.dirname(file), name: manifest.name, version: manifest.version };
  });
}

module.exports = { readManifests };
