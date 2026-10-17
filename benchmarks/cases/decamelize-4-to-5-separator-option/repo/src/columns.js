const decamelize = require('decamelize');

function columnName(field) {
  return decamelize(field);
}

module.exports = { columnName };
