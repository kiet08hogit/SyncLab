const LRU = require('lru-cache');

function createResponseCache({ maxBytes, maxAgeMs }) {
  const cache = new LRU({
    maxSize: maxBytes,
    sizeCalculation: (body) => Buffer.byteLength(body),
    ttl: maxAgeMs,
  });

  return {
    store(url, body) {
      cache.set(url, body);
    },
    lookup(url) {
      return cache.get(url);
    },
    bytesUsed() {
      return cache.calculatedSize;
    },
  };
}

module.exports = { createResponseCache };
