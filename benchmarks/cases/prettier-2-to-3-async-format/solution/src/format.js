const prettier = require('prettier');
const { parserFor } = require('./parsers');

const OPTIONS = { singleQuote: true, printWidth: 100 };

async function formatProject(files) {
  const formatted = {};
  for (const [file, source] of Object.entries(files)) {
    const parser = parserFor(file);
    formatted[file] = parser ? await prettier.format(source, { ...OPTIONS, parser }) : source;
  }
  return formatted;
}

async function unformattedFiles(files) {
  const result = [];
  for (const file of Object.keys(files)) {
    const parser = parserFor(file);
    if (parser !== null && !(await prettier.check(files[file], { ...OPTIONS, parser }))) {
      result.push(file);
    }
  }
  return result;
}

module.exports = { formatProject, unformattedFiles };
