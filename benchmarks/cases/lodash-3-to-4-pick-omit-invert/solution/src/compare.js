const _ = require('lodash');

function sameContact(a, b) {
  return _.isEqualWith(a, b, function (left, right) {
    if (typeof left === 'string' && typeof right === 'string') {
      return left.trim().toLowerCase() === right.trim().toLowerCase();
    }
    return undefined;
  });
}

module.exports = { sameContact };
