const { includes } = require('ramda');

function searchIndex(records) {
  const names = records.map((record) => record.name);
  function matches(name) {
    return includes(name, names);
  }
  return { matches };
}

module.exports = { searchIndex };
