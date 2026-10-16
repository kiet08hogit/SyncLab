const minimatch = require('minimatch');

function selectFiles(files, patterns) {
  return files.filter((file) => patterns.some((pattern) => minimatch(file, pattern, { dot: true })));
}

module.exports = { selectFiles };
