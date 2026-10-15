const _ = require('lodash');

function names(items) {
  return _.pluck(items, 'name');
}

module.exports = { names };
