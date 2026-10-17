const _ = require('lodash');

function byId(records) {
  return _.keyBy(records, 'id');
}

module.exports = { byId };
