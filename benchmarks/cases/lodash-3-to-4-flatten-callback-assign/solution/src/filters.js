const _ = require('lodash');

function buildFilter(criteria) {
  const matchers = criteria.map(function (criterion) {
    return _.iteratee(criterion);
  });
  return function (record) {
    return matchers.every(function (matcher) {
      return matcher(record);
    });
  };
}

module.exports = { buildFilter };
