const { parse, stringify } = require('query-string').default;

function normalize(search) {
  return stringify(parse(search), { skipNull: true, skipEmptyString: true });
}

module.exports = { normalize };
