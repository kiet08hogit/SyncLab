const { contains, uniq } = require('ramda');

function tagSet(tags) {
  const unique = uniq(tags);
  return {
    size: unique.length,
    has(tag) {
      return contains(tag, unique);
    },
  };
}

module.exports = { tagSet };
