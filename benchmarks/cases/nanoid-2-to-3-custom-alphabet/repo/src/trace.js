const nonSecure = require('nanoid/non-secure');

function traceHeaders(headers = {}) {
  return { ...headers, 'x-trace-id': headers['x-trace-id'] || nonSecure(12) };
}

module.exports = { traceHeaders };
