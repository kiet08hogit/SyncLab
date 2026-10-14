const _ = require('lodash');

function labels(records) {
  return _.map(records, 'label');
}

module.exports = { labels };
