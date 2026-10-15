const R = require('ramda');

function hasValue(list, value) {
  return R.contains(value, list);
}

module.exports = { hasValue };
