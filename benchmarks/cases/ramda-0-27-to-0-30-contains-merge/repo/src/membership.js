const R = require('ramda');

function isMember(team, userId) {
  return R.contains(userId, team.memberIds);
}

module.exports = { isMember };
