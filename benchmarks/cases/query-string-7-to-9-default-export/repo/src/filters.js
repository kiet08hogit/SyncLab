const qs = require('query-string');

function readFilters(search) {
  const query = qs.parse(search, { parseNumbers: true, arrayFormat: 'comma' });
  return {
    page: query.page || 1,
    tags: [].concat(query.tag || []),
  };
}

module.exports = { readFilters };
