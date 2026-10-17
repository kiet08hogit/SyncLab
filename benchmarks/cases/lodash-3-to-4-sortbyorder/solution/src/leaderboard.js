const _ = require('lodash');

function standings(teams) {
  return _.orderBy(teams, ['points', 'goalDiff', 'name'], ['desc', 'desc', 'asc']);
}

module.exports = { standings };
