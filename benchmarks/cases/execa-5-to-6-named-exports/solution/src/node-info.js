const { execaSync } = require('execa');

function nodeVersion() {
  const { stdout } = execaSync(process.execPath, ['--version']);
  return stdout.replace(/^v/, '');
}

module.exports = { nodeVersion };
