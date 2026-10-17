const fetch = require('node-fetch');
const { jsonHeaders } = require('./headers.js');

async function getUser(baseUrl, id, token) {
  const response = await fetch(`${baseUrl}/users/${id}`, { headers: jsonHeaders(token) });
  if (response.status === 404) return null;
  return response.json();
}

module.exports = { getUser };
