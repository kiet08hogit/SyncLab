const prettier = require('prettier');
const { parserFor } = require('./parsers');

const OPTIONS = { singleQuote: true, printWidth: 100 };

async function formatProject(files) {
  const formatted = {};
  for (const [file, source] of Object.entries(files)) {
    const parser = parserFor(file);
    formatted[file] = parser ? prettier.format(source, { ...OPTIONS, parser }) : source;
  }
  return formatted;
}

function unformattedFiles(files) {
  return Object.keys(files).filter((file) => {
    const parser = parserFor(file);
    return parser !== null && !prettier.check(files[file], { ...OPTIONS, parser });
  });
}

module.exports = { formatProject, unformattedFiles };
