const _ = require('lodash');

function allPermissions(roleTree) {
  return _.uniq(_.flatten(roleTree, true)).sort();
}

module.exports = { allPermissions };
