const R = require('ramda');

const EDITOR_ROLES = ['admin', 'editor'];

function canEdit(user) {
  return R.contains(user.role, EDITOR_ROLES);
}

module.exports = { canEdit };
