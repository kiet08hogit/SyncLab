const LRU = require('lru-cache');

function createSessionStore(limit) {
  const cache = new LRU({ max: limit });

  return {
    save(id, session) {
      cache.set(id, session);
    },
    load(id) {
      return cache.get(id);
    },
    end(id) {
      cache.delete(id);
    },
    activeIds() {
      return [...cache.keys()];
    },
    clear() {
      cache.clear();
    },
  };
}

module.exports = { createSessionStore };
