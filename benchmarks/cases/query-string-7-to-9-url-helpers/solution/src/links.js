const qs = require('query-string').default;

function linkBuilder(baseUrl) {
  function build(path, query) {
    return qs.stringifyUrl({ url: `${baseUrl}${path}`, query }, { skipNull: true });
  }
  return { build };
}

module.exports = { linkBuilder };
