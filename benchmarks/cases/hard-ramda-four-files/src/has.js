const R = require('ramda');

function hasId(ids, id) {
  return R.contains(id, ids);
}

module.exports = { hasId };
