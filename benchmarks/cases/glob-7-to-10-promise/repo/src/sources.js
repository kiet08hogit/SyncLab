const glob = require('glob');

function findSources(cwd) {
  return new Promise((resolve, reject) => {
    glob('**/*.js', { cwd, nodir: true, ignore: ['node_modules/**', 'dist/**'] }, (err, files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });
}

module.exports = { findSources };
