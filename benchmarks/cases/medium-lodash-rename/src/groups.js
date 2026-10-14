const _ = require('lodash');

function byId(records) {
  return _.indexBy(records, 'id');
}

module.exports = { byId };
