const _ = require('lodash');

function recordNames(records) {
  return _.pluck(records, 'name');
}

module.exports = { recordNames };
