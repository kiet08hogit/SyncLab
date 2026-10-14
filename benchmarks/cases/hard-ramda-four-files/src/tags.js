const { contains } = require('ramda');

function tagSet(tags) {
  return {
    includesTag(tag) {
      return contains(tag, tags);
    },
  };
}

module.exports = { tagSet };
