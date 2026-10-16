const R = require('ramda');

function updateProfile(profile, changes) {
  return R.merge(profile, changes);
}

module.exports = { updateProfile };
