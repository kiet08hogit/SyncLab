const R = require('ramda');

function loadConfig(defaults, env) {
  return {
    values() {
      return R.merge(defaults, env);
    },
    allows(flag) {
      return R.contains(flag, env.flags || defaults.flags);
    },
  };
}

module.exports = { loadConfig };
