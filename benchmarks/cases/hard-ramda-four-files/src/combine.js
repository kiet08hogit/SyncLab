const R = require('ramda');

function combine(left, right) {
  return R.merge(left, right);
}

module.exports = { combine };
