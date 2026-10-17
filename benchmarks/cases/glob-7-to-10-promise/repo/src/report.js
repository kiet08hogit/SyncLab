const { findSources } = require('./sources.js');
const { readManifests } = require('./manifests.js');

async function workspaceReport(cwd) {
  const sources = await findSources(cwd);
  const packages = readManifests(cwd).map((manifest) => ({
    ...manifest,
    files: sources.filter((file) => file.startsWith(`${manifest.dir}/`)).length,
  }));
  return { totalFiles: sources.length, packages };
}

module.exports = { workspaceReport };
