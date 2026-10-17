const R = require('ramda');

function loadConfig(defaults, env) {
  return {
    values() {
      return R.mergeRight(defaults, env);
    },
    allows(flag) {
      return R.includes(flag, env.flags || defaults.flags);
    },
  };
}

module.exports = { loadConfig };
