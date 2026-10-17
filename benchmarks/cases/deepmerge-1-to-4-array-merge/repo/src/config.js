const merge = require('deepmerge');

const defaults = {
  server: { port: 3000, hosts: ['localhost'] },
  features: ['search'],
  logging: { level: 'info', targets: [{ type: 'console', color: true }] },
};

function resolveConfig(...layers) {
  return layers.reduce((config, layer) => merge(config, layer), defaults);
}

module.exports = { defaults, resolveConfig };
