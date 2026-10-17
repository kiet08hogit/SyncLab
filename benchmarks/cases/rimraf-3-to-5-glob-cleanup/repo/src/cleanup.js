const path = require('node:path');
const rimraf = require('rimraf');

function remove(target) {
  return new Promise((resolve, reject) => {
    rimraf(target, (err) => (err ? reject(err) : resolve()));
  });
}

async function cleanWorkspace(root) {
  await remove(path.join(root, 'build'));
  await remove(path.join(root, '**/*.tmp'));
}

module.exports = { cleanWorkspace };
