const { ajv } = require('./ajv.js');

const validate = ajv.compile({
  type: 'object',
  properties: { city: { type: 'string' }, zip: { type: 'string', pattern: '^[0-9]{5}$' } },
});

function addressFieldErrors(address) {
  const firstError = () => {
    validate(address);
    return validate.errors ? validate.errors[0] : null;
  };
  const error = firstError();
  return error ? { field: error.dataPath, rule: error.keyword } : null;
}

module.exports = { addressFieldErrors };
