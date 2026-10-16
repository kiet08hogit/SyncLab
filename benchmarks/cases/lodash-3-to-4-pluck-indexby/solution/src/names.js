const _ = require('lodash');

function recordNames(records) {
  return _.map(records, 'name');
}

module.exports = { recordNames };
