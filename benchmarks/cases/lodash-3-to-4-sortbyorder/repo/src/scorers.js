const _ = require('lodash');

function topScorers(players, count) {
  return _.take(_.sortByOrder(players, ['goals', 'minutes'], ['desc', 'asc']), count);
}

module.exports = { topScorers };
