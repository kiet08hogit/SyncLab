const { Headers } = require('node-fetch');

function jsonHeaders(token) {
  const headers = new Headers({ accept: 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

module.exports = { jsonHeaders };
