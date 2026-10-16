const Ajv = require('ajv');

const ajv = new Ajv({ jsonPointers: true, allErrors: true });

const validate = ajv.compile({
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'integer', minimum: 13 },
  },
});

function signupErrors(form) {
  if (validate(form)) return {};
  const errors = {};
  for (const error of validate.errors) {
    errors[error.dataPath] = error.keyword;
  }
  return errors;
}

module.exports = { signupErrors };
