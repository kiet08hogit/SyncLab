const Ajv = require('ajv');
const validate = new Ajv().compile({ type: 'object', properties: { sku: { type: 'string' } } });

function skuPath(data) {
  validate(data);
  return validate.errors[0].dataPath;
}

module.exports = { skuPath };
