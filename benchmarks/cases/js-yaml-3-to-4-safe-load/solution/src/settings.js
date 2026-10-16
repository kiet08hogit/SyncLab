const fs = require('node:fs');
const yaml = require('js-yaml');

const DEFAULTS = {
  port: 8080,
  host: 'localhost',
  features: [],
};

function parseSettings(text) {
  const data = yaml.load(text) || {};
  return { ...DEFAULTS, ...data };
}

function readSettings(file) {
  return parseSettings(fs.readFileSync(file, 'utf8'));
}

module.exports = { parseSettings, readSettings };
