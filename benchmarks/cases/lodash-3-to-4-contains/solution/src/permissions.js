const _ = require('lodash');

const ADMIN_ROLES = ['owner', 'admin'];

function canManageBilling(user) {
  return _.includes(ADMIN_ROLES, user.role) || _.includes(user.grants, 'billing');
}

module.exports = { canManageBilling };
