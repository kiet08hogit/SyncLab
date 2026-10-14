const R = require('ramda');

function stable(names, extra) {
  return {
    has: (name) => R.includes(name, names),
    merged: R.mergeRight({ enabled: false }, extra),
  };
}

module.exports = { stable };
