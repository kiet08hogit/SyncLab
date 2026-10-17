const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { nodeVersion } = require('../src/node-info.js');
const { evaluate, runScript } = require('../src/scripts.js');
const { runTask } = require('../src/tasks.js');

describe('child processes', () => {
  it('reads the node version', () => {
    assert.equal(nodeVersion(), process.versions.node);
  });

  it('evaluates an expression', async () => {
    assert.equal(await evaluate('6 * 7'), '42');
  });

  it('runs a script with stdin and captures failures', async () => {
    const ok = await runScript('process.stdin.on("data", (d) => process.stdout.write(String(d).toUpperCase()))', 'hello');
    assert.deepEqual(ok, { code: 0, output: 'HELLO', errors: '' });

    const failed = await runScript('console.error("boom"); process.exit(3)');
    assert.deepEqual(failed, { code: 3, output: '', errors: 'boom' });
  });

  it('runs a task command line', async () => {
    const lines = await runTask(`${process.execPath} -e console.log(process.env.STAGE);console.log(2)`, { STAGE: 'ci' });
    assert.deepEqual(lines, ['ci', '2']);
  });
});
