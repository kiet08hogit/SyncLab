const R = require('ramda');

function updateProfile(profile, changes) {
  return R.mergeRight(profile, changes);
}

module.exports = { updateProfile };
