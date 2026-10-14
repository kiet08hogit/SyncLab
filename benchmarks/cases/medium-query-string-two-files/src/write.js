const qs = require('query-string');

function writeQuery(data) {
  return qs.stringify(data);
}

module.exports = { writeQuery };
