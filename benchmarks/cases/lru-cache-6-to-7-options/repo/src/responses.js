const LRU = require('lru-cache');

function createResponseCache({ maxBytes, maxAgeMs }) {
  const cache = new LRU({
    max: maxBytes,
    length: (body) => Buffer.byteLength(body),
    maxAge: maxAgeMs,
  });

  return {
    store(url, body) {
      cache.set(url, body);
    },
    lookup(url) {
      return cache.get(url);
    },
    bytesUsed() {
      return cache.length;
    },
  };
}

module.exports = { createResponseCache };
