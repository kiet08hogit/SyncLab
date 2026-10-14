const map = require('lodash/map');

function titles(items) {
  return map(items, 'title');
}

module.exports = { titles };
