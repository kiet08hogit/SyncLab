const R = require('ramda');

const DEFAULTS = { theme: 'light', pageSize: 20, notifications: true };

function resolveSettings(overrides) {
  return R.mergeRight(DEFAULTS, overrides);
}

module.exports = { resolveSettings };
