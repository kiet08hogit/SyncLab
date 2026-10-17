const fs = require('node:fs');
const yaml = require('js-yaml');

function loadConfig(file) {
  return yaml.load(fs.readFileSync(file, 'utf8'), { filename: file }) || {};
}

function loadManifests(text) {
  const documents = [];
  yaml.loadAll(text, (doc) => {
    if (doc) documents.push(doc);
  });
  return documents;
}

module.exports = { loadConfig, loadManifests };
