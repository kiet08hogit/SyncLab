const _ = require('lodash');

function columnWidths(records) {
  const keys = _.keys(records[0]);
  const columns = _.zip.apply(_, records.map(function (record) {
    return keys.map(function (key) {
      return String(record[key]).length;
    });
  }));
  return keys.map(function (key, index) {
    return Math.max(key.length, _.max(columns[index]));
  });
}

module.exports = { columnWidths };
