const _ = require('lodash');

function active(items) {
  return _.where(items, { active: true });
}

module.exports = { active };
