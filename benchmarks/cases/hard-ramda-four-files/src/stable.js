const R = require('ramda');

function stable(labels, extra) {
  return {
    has: (label) => R.includes(label, labels),
    merged: R.mergeRight({ on: true }, extra),
  };
}

module.exports = { stable };
