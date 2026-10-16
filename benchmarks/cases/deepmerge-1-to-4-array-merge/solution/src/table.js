const merge = require('./merge.js');

function applyColumnOverrides(columns, overrides) {
  return merge(columns, overrides);
}

module.exports = { applyColumnOverrides };
