const fetch = require('node-fetch').default;

function readyFetch() {
  return fetch;
}

module.exports = { readyFetch };
