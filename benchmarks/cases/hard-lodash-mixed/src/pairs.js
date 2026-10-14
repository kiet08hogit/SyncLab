const _ = require('lodash');

function entries(item) {
  return _.pairs(item);
}

module.exports = { entries };
