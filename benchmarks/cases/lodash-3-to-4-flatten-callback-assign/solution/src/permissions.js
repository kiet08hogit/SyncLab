const _ = require('lodash');

function allPermissions(roleTree) {
  return _.uniq(_.flattenDeep(roleTree)).sort();
}

module.exports = { allPermissions };
