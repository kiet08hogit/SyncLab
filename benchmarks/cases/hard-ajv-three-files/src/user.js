const Ajv = require('ajv');
const validate = new Ajv().compile({ type: 'object', properties: { email: { type: 'string' } } });

function emailPath(data) {
  function first() {
    validate(data);
    return validate.errors[0].dataPath;
  }
  return first();
}

module.exports = { emailPath };
