const { contains } = require('ramda');

function search(records) {
  function matches(name) {
    return contains(name, records.map((record) => record.name));
  }
  return { matches };
}

module.exports = { search };
