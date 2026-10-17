const _ = require('lodash');

function alphabetical(players) {
  return _.sortBy(players, 'name');
}

module.exports = { alphabetical };
