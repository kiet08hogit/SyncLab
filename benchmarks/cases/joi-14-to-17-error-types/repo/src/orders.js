const Joi = require('joi');
const { orderSchema } = require('./schemas');
const { toProblems } = require('./error-codes');

function checkOrder(payload) {
  return Joi.validate(payload, orderSchema, { abortEarly: false }, (error, value) => {
    if (error) {
      return { accepted: false, problems: toProblems(error.details) };
    }
    return { accepted: true, order: value };
  });
}

module.exports = { checkOrder };
