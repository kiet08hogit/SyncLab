const glob = require('glob');

function splitPatterns(inputs) {
  const literal = [];
  const patterns = [];
  for (const input of inputs) {
    if (glob.hasMagic(input)) patterns.push(input);
    else literal.push(input);
  }
  return { literal, patterns };
}

module.exports = { splitPatterns };
