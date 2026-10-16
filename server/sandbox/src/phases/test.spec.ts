import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readTestOutput } from '../state.js';
import { test as runTestPhase } from './test.js';

function restoreEnv(saved: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(process.env)) {
    if (!(name in saved)) {
      delete process.env[name];
    }
  }
  Object.assign(process.env, saved);
}

describe('test phase', () => {
  let savedEnv: NodeJS.ProcessEnv;
  let workspace: string;
  let repoDir: string;
  let stateDir: string;

  async function writeTestScript(script: string): Promise<void> {
    await fs.writeFile(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'fixture-app', version: '1.0.0', private: true, scripts: { test: script } }),
    );
  }

  beforeEach(async () => {
    savedEnv = { ...process.env };
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-test-phase-'));
    repoDir = path.join(workspace, 'repo');
    stateDir = path.join(workspace, 'state');
    await fs.mkdir(repoDir);

    Object.assign(process.env, {
      SANDBOX_WORKSPACE: workspace,
      REPO_URL: 'https://github.com/acme/widgets.git',
      REPO_FULL_NAME: 'acme/widgets',
      DEPENDENCY_NAME: 'lodash',
      TARGET_VERSION: '4.17.21',
      BRANCH_NAME: 'synclab/lodash-4.17.21',
      LLM_MODEL: 'qwen2.5-coder:14b',
    });
    // The test container never receives credentials.
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(async () => {
    restoreEnv(savedEnv);
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('passes when the repository test suite passes', async () => {
    await writeTestScript('node -e "console.log(\'all 3 tests passed\')"');

    const result = await runTestPhase();

    assert.equal(result.phase, 'test');
    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].step, 'TEST');
    assert.equal(result.steps[0].exitCode, 0);
    assert.match(result.steps[0].output, /all 3 tests passed/);
  });

  it('fails with the exit code when the repository test suite fails', async () => {
    await writeTestScript('node -e "console.error(\'expected 1 to equal 2\'); process.exit(7)"');

    const result = await runTestPhase();

    assert.equal(result.ok, false);
    assert.equal(result.error, 'test suite failed with exit code 7');
    assert.equal(result.steps[0].exitCode, 7);
    assert.match(result.steps[0].output, /expected 1 to equal 2/);
  });

  it('saves the test output for the next refactor attempt', async () => {
    await writeTestScript('node -e "console.error(\'TypeError: _.pluck is not a function\'); process.exit(1)"');

    await runTestPhase();

    assert.match((await readTestOutput(stateDir)) ?? '', /TypeError: _\.pluck is not a function/);
  });

  it('fails when the repository defines no test script', async () => {
    await fs.writeFile(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'fixture-app', version: '1.0.0' }));

    const result = await runTestPhase();

    assert.equal(result.ok, false);
    assert.notEqual(result.steps[0].exitCode, 0);
    assert.match((await readTestOutput(stateDir)) ?? '', /Missing script: "test"/);
  });
});
