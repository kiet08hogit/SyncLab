const { glob } = require('glob');

async function findSources(cwd) {
  const files = await glob('**/*.js', { cwd, nodir: true, ignore: ['node_modules/**', 'dist/**'] });
  return files.sort();
}

module.exports = { findSources };
