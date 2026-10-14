const R = require('ramda');

function hasLabel(labels, label) {
  return R.includes(label, labels);
}

module.exports = { hasLabel };
