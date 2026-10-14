const R = require('ramda');

function overlay(base, patch) {
  const apply = (extra) => R.merge(R.merge(base, patch), extra);
  return apply;
}

module.exports = { overlay };
