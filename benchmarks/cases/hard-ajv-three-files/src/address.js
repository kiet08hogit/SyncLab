const Ajv = require('ajv');
const validate = new Ajv().compile({ type: 'object', properties: { city: { type: 'string' } } });

function cityPath(data) {
  const error = () => {
    validate(data);
    return validate.errors[0];
  };
  return error().dataPath;
}

module.exports = { cityPath };
