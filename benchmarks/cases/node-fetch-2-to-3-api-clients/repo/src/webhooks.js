const fetch = require('node-fetch');

function webhookSender(endpoint) {
  async function send(event, payload) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, payload }),
    });
    return response.status;
  }
  return { send };
}

module.exports = { webhookSender };
