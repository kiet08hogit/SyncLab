const { orderSchema } = require('./schemas');
const { toProblems } = require('./error-codes');

function checkOrder(payload) {
  const { error, value } = orderSchema.validate(payload, { abortEarly: false });
  if (error) {
    return { accepted: false, problems: toProblems(error.details) };
  }
  return { accepted: true, order: value };
}

module.exports = { checkOrder };
