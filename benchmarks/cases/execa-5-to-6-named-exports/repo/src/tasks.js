const execa = require('execa');

async function runTask(commandLine, env = {}) {
  const { stdout } = await execa.command(commandLine, { env });
  return stdout.split('\n').filter(Boolean);
}

module.exports = { runTask };
