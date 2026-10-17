const yaml = require('js-yaml');

function exportConfig(config) {
  return yaml.safeDump(config, { sortKeys: true, lineWidth: -1 });
}

module.exports = { exportConfig };
