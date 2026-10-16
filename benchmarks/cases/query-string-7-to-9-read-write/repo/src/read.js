const qs = require('query-string');

function readSort(search) {
  const { sort = 'created', order = 'desc' } = qs.parse(search);
  return { sort, order };
}

module.exports = { readSort };
