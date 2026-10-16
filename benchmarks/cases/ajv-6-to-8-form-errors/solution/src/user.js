const { ajv } = require('./ajv.js');

const validate = ajv.compile({
  type: 'object',
  properties: { email: { type: 'string' } },
});

function userErrorPaths(user) {
  validate(user);
  return (validate.errors || []).map((error) => error.instancePath);
}

module.exports = { userErrorPaths };
