const path = require('node:path');

const YAML_EXTENSIONS = new Set(['.yml', '.yaml']);

function formatFor(file) {
  return YAML_EXTENSIONS.has(path.extname(file).toLowerCase()) ? 'yaml' : 'json';
}

module.exports = { formatFor };
