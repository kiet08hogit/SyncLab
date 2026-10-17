const fetch = require('node-fetch').default;

async function isHealthy(baseUrl) {
  const response = await fetch(`${baseUrl}/health`);
  return response.ok;
}

module.exports = { isHealthy };
