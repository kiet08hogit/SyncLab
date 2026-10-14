const qs = require('query-string').default;
function readyParse(input) { return qs.parse(input); }
module.exports = { readyParse };
