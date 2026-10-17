const _ = require('lodash');

function membersByTeam(assignments) {
  return _.invertBy(assignments);
}

module.exports = { membersByTeam };
