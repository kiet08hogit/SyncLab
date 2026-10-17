const { ajv } = require('./ajv.js');

const validate = ajv.compile({
  type: 'object',
  properties: {
    sku: { type: 'string' },
    lines: { type: 'array', items: { type: 'object', properties: { qty: { type: 'integer', minimum: 1 } } } },
  },
});

function orderProblems(order) {
  if (validate(order)) return [];
  return validate.errors.map((error) => `${error.dataPath} ${error.keyword}`);
}

module.exports = { orderProblems };
