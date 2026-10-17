const { includes, uniq } = require('ramda');

function tagSet(tags) {
  const unique = uniq(tags);
  return {
    size: unique.length,
    has(tag) {
      return includes(tag, unique);
    },
  };
}

module.exports = { tagSet };
