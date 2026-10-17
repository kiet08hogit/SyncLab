const Ajv = require('ajv');

const ajv = new Ajv({ jsonPointers: true, allErrors: true });

module.exports = { ajv };
