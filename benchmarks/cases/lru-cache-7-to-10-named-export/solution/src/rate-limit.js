const { LRUCache } = require('lru-cache');

function createRateLimiter({ limit, windowMs, maxClients = 5000 }) {
  const hits = new LRUCache({ max: maxClients, ttl: windowMs });

  return function allow(client) {
    const count = (hits.get(client) || 0) + 1;
    hits.set(client, count);
    return count <= limit;
  };
}

module.exports = { createRateLimiter };
