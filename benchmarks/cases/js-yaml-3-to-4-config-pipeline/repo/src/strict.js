const yaml = require('js-yaml');

function parseStrict(text) {
  return yaml.load(text, { schema: yaml.JSON_SCHEMA });
}

module.exports = { parseStrict };
