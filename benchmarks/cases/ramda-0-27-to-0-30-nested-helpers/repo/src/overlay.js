const R = require('ramda');

function overlay(base, patch) {
  return (extra) => R.merge(R.merge(base, patch), extra);
}

module.exports = { overlay };
