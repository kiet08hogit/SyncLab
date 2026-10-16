const merge = require('deepmerge');

function applyColumnOverrides(columns, overrides) {
  return merge(columns, overrides);
}

module.exports = { applyColumnOverrides };
