const path = require('path');

const PARSERS = {
  '.js': 'babel',
  '.css': 'css',
  '.json': 'json',
};

function parserFor(file) {
  return PARSERS[path.extname(file)] || null;
}

module.exports = { parserFor };
