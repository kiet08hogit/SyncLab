const pathToRegexp = require('path-to-regexp');

function createRouter() {
  const routes = [];

  return {
    add(method, pattern, handler) {
      const keys = [];
      const regexp = pathToRegexp(pattern, keys);
      routes.push({ method, regexp, keys, handler });
    },

    handle(method, url) {
      const pathname = url.split('?')[0];
      for (const route of routes) {
        if (route.method !== method) continue;
        const match = route.regexp.exec(pathname);
        if (!match) continue;
        const params = {};
        route.keys.forEach((key, index) => {
          const value = match[index + 1];
          if (value !== undefined) params[key.name] = decodeURIComponent(value);
        });
        return route.handler(params);
      }
      return null;
    },
  };
}

module.exports = { createRouter };
