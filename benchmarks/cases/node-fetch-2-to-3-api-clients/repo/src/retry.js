const fetch = require('node-fetch');

async function fetchWithRetry(url, attempts = 3) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url);
    if (response.status < 500) return response;
    lastStatus = response.status;
  }
  throw new Error(`Gave up after ${attempts} attempts (last status ${lastStatus})`);
}

module.exports = { fetchWithRetry };
