const path = require('node:path');
const { rimraf } = require('rimraf');

async function cleanWorkspace(root) {
  await rimraf(path.join(root, 'build'));
  await rimraf(path.join(root, '**/*.tmp'), { glob: true });
}

module.exports = { cleanWorkspace };
