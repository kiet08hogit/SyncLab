const { parse, stringify } = require('query-string');

function roundTrip(input) {
  return stringify(parse(input));
}

module.exports = { roundTrip };
