const qs = require('query-string');
function nestedWrite(data) {
  function inner() { return qs.stringify(data); }
  return inner();
}
module.exports = { nestedWrite };
