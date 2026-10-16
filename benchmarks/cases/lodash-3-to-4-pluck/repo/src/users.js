const _ = require('lodash');

function userNames(users) {
  return _.pluck(users, 'name');
}

function activeUserNames(users) {
  return userNames(users.filter((user) => user.active));
}

module.exports = { userNames, activeUserNames };
