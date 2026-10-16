const R = require('ramda');

function overlay(base, patch) {
  return (extra) => R.mergeRight(R.mergeRight(base, patch), extra);
}

module.exports = { overlay };
