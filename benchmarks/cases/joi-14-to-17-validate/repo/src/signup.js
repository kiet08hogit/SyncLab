const Joi = require('joi');

const signupSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  newsletter: Joi.boolean().default(false),
});

function parseSignup(input) {
  const { error, value } = Joi.validate(input, signupSchema, { stripUnknown: true });
  if (error) {
    return { ok: false, field: error.details[0].path.join('.') };
  }
  return { ok: true, value };
}

module.exports = { parseSignup };
