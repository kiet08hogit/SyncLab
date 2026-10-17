const LRU = require('lru-cache');

function createSessionStore(limit) {
  const cache = new LRU(limit);

  return {
    save(id, session) {
      cache.set(id, session);
    },
    load(id) {
      return cache.get(id);
    },
    end(id) {
      cache.del(id);
    },
    activeIds() {
      return cache.keys();
    },
    clear() {
      cache.reset();
    },
  };
}

module.exports = { createSessionStore };
