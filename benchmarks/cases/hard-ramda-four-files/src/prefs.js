const R = require('ramda');

function withDefaults(defaults, prefs) {
  function apply() {
    return R.merge(defaults, prefs);
  }
  return apply();
}

module.exports = { withDefaults };
