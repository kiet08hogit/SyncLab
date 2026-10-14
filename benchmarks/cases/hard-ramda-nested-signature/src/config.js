const R = require('ramda');

function config(defaults, env) {
  return {
    value() {
      return R.merge(defaults, env);
    },
    allows(flag, flags) {
      return R.contains(flag, flags);
    },
  };
}

module.exports = { config };
