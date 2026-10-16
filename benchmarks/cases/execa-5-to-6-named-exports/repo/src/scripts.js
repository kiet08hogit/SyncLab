const execa = require('execa');

async function evaluate(expression) {
  const { stdout } = await execa(process.execPath, ['-p', expression]);
  return stdout;
}

async function runScript(source, input) {
  const result = await execa(process.execPath, ['-e', source], { input, reject: false });
  return { code: result.exitCode, output: result.stdout, errors: result.stderr };
}

module.exports = { evaluate, runScript };
