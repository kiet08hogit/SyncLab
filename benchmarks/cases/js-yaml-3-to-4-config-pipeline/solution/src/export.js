const yaml = require('js-yaml');

function exportConfig(config) {
  return yaml.dump(config, { sortKeys: true, lineWidth: -1 });
}

module.exports = { exportConfig };
