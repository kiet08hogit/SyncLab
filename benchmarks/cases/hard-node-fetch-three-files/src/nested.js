const fetch = require('node-fetch');
function nestedFetch() {
  function inner() { return fetch; }
  return inner();
}
module.exports = { nestedFetch };
