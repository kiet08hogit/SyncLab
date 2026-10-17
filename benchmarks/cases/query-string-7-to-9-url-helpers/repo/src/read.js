const qs = require('query-string');

function readQuery(search) {
  return { ...qs.parse(search, { parseBooleans: true }) };
}

module.exports = { readQuery };
