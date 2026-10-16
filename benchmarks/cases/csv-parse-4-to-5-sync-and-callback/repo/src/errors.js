const { CsvError } = require('csv-parse');

function describeImportError(error) {
  if (error instanceof CsvError) {
    return `Malformed file (${error.code})`;
  }
  return 'Import failed';
}

module.exports = { describeImportError };
