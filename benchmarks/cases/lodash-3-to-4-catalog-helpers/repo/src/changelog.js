function releaseNote(version) {
  return `Catalog ${version}: switched list helpers to lodash and trimmed bundle size.`;
}

module.exports = { releaseNote };
