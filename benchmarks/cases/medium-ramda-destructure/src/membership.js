const { contains } = require('ramda');

function nested(list) {
  return {
    has(value) {
      return contains(value, list);
    },
  };
}

module.exports = { nested };
