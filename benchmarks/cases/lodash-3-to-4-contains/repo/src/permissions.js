const _ = require('lodash');

const ADMIN_ROLES = ['owner', 'admin'];

function canManageBilling(user) {
  return _.contains(ADMIN_ROLES, user.role) || _.contains(user.grants, 'billing');
}

module.exports = { canManageBilling };
