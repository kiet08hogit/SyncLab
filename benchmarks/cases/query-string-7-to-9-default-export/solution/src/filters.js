const qs = require('query-string').default;

function readFilters(search) {
  const query = qs.parse(search, { parseNumbers: true, arrayFormat: 'comma' });
  return {
    page: query.page || 1,
    tags: [].concat(query.tag || []),
  };
}

module.exports = { readFilters };
