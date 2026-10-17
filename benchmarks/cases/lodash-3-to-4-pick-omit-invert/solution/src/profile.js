const _ = require('lodash');

function filledFields(profile) {
  return _.pickBy(profile, function (value) {
    return value !== null && value !== undefined && value !== '';
  });
}

function withoutInternal(profile) {
  return _.omitBy(profile, function (value, key) {
    return key.charAt(0) === '_';
  });
}

module.exports = { filledFields, withoutInternal };
