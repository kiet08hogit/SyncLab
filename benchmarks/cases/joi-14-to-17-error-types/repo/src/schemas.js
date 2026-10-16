const Joi = require('joi');

const orderSchema = Joi.object({
  sku: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required(),
  shipping: Joi.string().valid('standard', 'express', 'pickup').default('standard'),
  note: Joi.string().max(140),
});

module.exports = { orderSchema };
