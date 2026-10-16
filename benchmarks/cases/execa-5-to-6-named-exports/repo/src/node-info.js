const execa = require('execa');

function nodeVersion() {
  const { stdout } = execa.sync(process.execPath, ['--version']);
  return stdout.replace(/^v/, '');
}

module.exports = { nodeVersion };
