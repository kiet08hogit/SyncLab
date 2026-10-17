const decamelize = require('decamelize');

function toHeaderName(key) {
  return decamelize(key, { separator: '-' })
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
}

function toHeaders(options) {
  const headers = {};
  for (const [key, value] of Object.entries(options)) {
    headers[toHeaderName(key)] = String(value);
  }
  return headers;
}

module.exports = { toHeaderName, toHeaders };
