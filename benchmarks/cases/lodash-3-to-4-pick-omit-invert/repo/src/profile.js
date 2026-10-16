const _ = require('lodash');

function filledFields(profile) {
  return _.pick(profile, function (value) {
    return value !== null && value !== undefined && value !== '';
  });
}

function withoutInternal(profile) {
  return _.omit(profile, function (value, key) {
    return key.charAt(0) === '_';
  });
}

module.exports = { filledFields, withoutInternal };
