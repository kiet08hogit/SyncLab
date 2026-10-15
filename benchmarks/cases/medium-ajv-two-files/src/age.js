const Ajv = require('ajv');
const validate = new Ajv().compile({ type: 'object', properties: { age: { type: 'number' } } });

function agePath(data) {
  validate(data);
  return validate.errors[0].dataPath;
}

module.exports = { agePath };
