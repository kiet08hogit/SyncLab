const { ajv } = require('./ajv.js');

const validate = ajv.compile({
  type: 'object',
  required: ['name', 'email'],
});

function missingFields(record) {
  if (validate(record)) return [];
  return validate.errors.map((error) => error.params.missingProperty);
}

module.exports = { missingFields };
