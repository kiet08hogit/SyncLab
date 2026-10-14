const _ = require('lodash');

function findById(items, id) {
  return _.findWhere(items, { id });
}

module.exports = { findById };
