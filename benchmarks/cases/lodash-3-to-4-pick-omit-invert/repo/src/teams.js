const _ = require('lodash');

function membersByTeam(assignments) {
  return _.invert(assignments, true);
}

module.exports = { membersByTeam };
