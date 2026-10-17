const { execaCommand } = require('execa');

async function runTask(commandLine, env = {}) {
  const { stdout } = await execaCommand(commandLine, { env });
  return stdout.split('\n').filter(Boolean);
}

module.exports = { runTask };
