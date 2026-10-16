const _ = require('lodash');

function parseCsv(text) {
  const rows = text.trim().split('\n').map(function (line) {
    return line.split(',');
  });
  const header = _.first(rows);
  return _.tail(rows).map(function (cells) {
    return _.zipObject(header, cells);
  });
}

module.exports = { parseCsv };
