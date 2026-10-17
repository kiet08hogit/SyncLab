const CODES = {
  'any.required': 'MISSING_FIELD',
  'any.only': 'UNSUPPORTED_VALUE',
  'string.empty': 'EMPTY_FIELD',
  'number.min': 'TOO_SMALL',
  'number.base': 'NOT_A_NUMBER',
  'string.max': 'TOO_LONG',
};

function toProblems(details) {
  return details.map((detail) => ({
    field: detail.path.join('.'),
    code: CODES[detail.type] || 'INVALID',
  }));
}

module.exports = { toProblems };
