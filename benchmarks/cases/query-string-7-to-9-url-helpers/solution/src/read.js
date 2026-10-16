const qs = require('query-string').default;

function readQuery(search) {
  return { ...qs.parse(search, { parseBooleans: true }) };
}

module.exports = { readQuery };
