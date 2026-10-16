const fs = require('node:fs');
const path = require('node:path');
const { globSync } = require('glob');

function readManifests(cwd) {
  return globSync('packages/*/package.json', { cwd })
    .sort()
    .map((file) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(cwd, file), 'utf8'));
      return { dir: path.dirname(file), name: manifest.name, version: manifest.version };
    });
}

module.exports = { readManifests };
