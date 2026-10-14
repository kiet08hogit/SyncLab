const Ajv = require('ajv');
const validate = new Ajv().compile({ type: 'object', properties: { name: { type: 'string' } } });

function namePath(data) {
  validate(data);
  return validate.errors[0].dataPath;
}

module.exports = { namePath };
