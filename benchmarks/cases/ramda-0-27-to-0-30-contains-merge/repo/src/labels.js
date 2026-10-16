const R = require('ramda');

function hasLabel(issue, label) {
  return R.includes(label, issue.labels);
}

module.exports = { hasLabel };
