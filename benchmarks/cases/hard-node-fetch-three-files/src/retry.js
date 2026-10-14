const fetch = require('node-fetch');
function retryFetch() { return fetch; }
module.exports = { retryFetch };
