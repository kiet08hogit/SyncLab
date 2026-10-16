const R = require('ramda');

function isMember(team, userId) {
  return R.includes(userId, team.memberIds);
}

module.exports = { isMember };
