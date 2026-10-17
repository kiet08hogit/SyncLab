const R = require('ramda');

function featureFlags(enabled, overrides) {
  return {
    isOn: (name) => R.includes(name, enabled),
    settings: R.mergeRight({ rollout: 0 }, overrides),
  };
}

module.exports = { featureFlags };
