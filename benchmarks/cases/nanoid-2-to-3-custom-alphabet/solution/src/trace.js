const { nanoid } = require('nanoid/non-secure');

function traceHeaders(headers = {}) {
  return { ...headers, 'x-trace-id': headers['x-trace-id'] || nanoid(12) };
}

module.exports = { traceHeaders };
