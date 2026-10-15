const Ajv = require('ajv');
const validate = new Ajv().compile({ type: 'object', properties: { ready: { type: 'boolean' } } });

function readyPath(data) {
  validate(data);
  return validate.errors[0].instancePath;
}

module.exports = { readyPath };
