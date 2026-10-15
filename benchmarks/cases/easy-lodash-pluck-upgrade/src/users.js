const _ = require('lodash');

function userNames(users) {
  return _.pluck(users, 'name');
}

module.exports = { userNames };
