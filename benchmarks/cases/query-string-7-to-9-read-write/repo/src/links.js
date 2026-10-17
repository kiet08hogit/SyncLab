const { parse, stringify } = require('query-string');

function withPage(search, page) {
  return `?${stringify({ ...parse(search), page })}`;
}

module.exports = { withPage };
