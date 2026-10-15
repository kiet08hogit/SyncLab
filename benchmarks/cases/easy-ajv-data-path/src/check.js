const Ajv = require('ajv');

const ajv = new Ajv();
const validate = ajv.compile({
  type: 'object',
  properties: { name: { type: 'string' } },
});

function nameErrorPath(data) {
  validate(data);
  return validate.errors[0].dataPath;
}

module.exports = { nameErrorPath };
