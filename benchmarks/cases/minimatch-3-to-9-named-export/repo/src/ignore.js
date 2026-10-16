const { Minimatch } = require('minimatch');

function createIgnore(patterns) {
  const matchers = patterns.map((pattern) => new Minimatch(pattern, { dot: true }));
  return (file) => matchers.some((matcher) => matcher.match(file));
}

module.exports = { createIgnore };
