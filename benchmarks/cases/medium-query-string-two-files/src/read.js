const qs = require('query-string');

function readQuery(input) {
  return qs.parse(input);
}

module.exports = { readQuery };
