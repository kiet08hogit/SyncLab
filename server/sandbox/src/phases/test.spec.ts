import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readTestOutput, readValidationFailure, writeValidationFailure } from '../state.js';
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
      LLM_MODEL: 'gemini-3.1-pro-preview',
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

  it('labels a normal run with the refactor attempt and the npm command', async () => {
    await writeTestScript('node -e "console.log(\'ok\')"');
    Object.assign(process.env, { REFACTOR_ATTEMPT: '2', REFACTOR_MAX_ATTEMPTS: '3' });
    delete process.env.TEST_BASELINE;

    const result = await runTestPhase();

    assert.equal(result.steps[0].step, 'TEST');
    assert.ok(result.steps[0].output.startsWith('Attempt 2/3\n$ npm test\n'), result.steps[0].output);
  });

  it('labels the run before the upgrade as the baseline', async () => {
    await writeTestScript('node -e "console.log(\'ok\')"');
    process.env.TEST_BASELINE = 'true';

    const result = await runTestPhase();

    assert.equal(result.ok, true);
    assert.equal(result.steps[0].step, 'BASELINE');
    assert.ok(
      result.steps[0].output.startsWith('Baseline run before the upgrade\n$ npm test\n'),
      result.steps[0].output,
    );
  });

  it('reports a failing baseline as a failed phase', async () => {
    await writeTestScript('node -e "process.exit(3)"');
    process.env.TEST_BASELINE = 'true';

    const result = await runTestPhase();

    assert.equal(result.ok, false);
    assert.equal(result.error, 'test suite failed with exit code 3');
    assert.equal(result.steps[0].step, 'BASELINE');
    assert.equal(result.steps[0].exitCode, 3);
  });

  it('only treats exactly "true" as a baseline run', async () => {
    await writeTestScript('node -e "console.log(\'ok\')"');
    for (const value of ['1', 'TRUE', 'yes', '']) {
      process.env.TEST_BASELINE = value;

      const result = await runTestPhase();

      assert.equal(result.steps[0].step, 'TEST', JSON.stringify(value));
    }
  });

  describe('with pnpm or yarn', () => {
    let bin: string;

    // A stand-in for corepack, so no package manager is downloaded: it echoes
    // the arguments and where corepack would keep its cache.
    beforeEach(async () => {
      bin = path.join(workspace, 'bin');
      await fs.mkdir(bin);
      await fs.writeFile(
        path.join(bin, 'corepack'),
        '#!/bin/sh\necho "fake corepack $* home=$COREPACK_HOME default-latest=$COREPACK_DEFAULT_TO_LATEST"\n',
        { mode: 0o755 },
      );
      process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
    });

    for (const [lockfile, packageManager, expected] of [
      ['pnpm-lock.yaml', undefined, 'corepack pnpm test'],
      ['yarn.lock', undefined, 'corepack yarn test'],
      ['package-lock.json', 'yarn@4.5.0', 'corepack yarn test'],
    ] as const) {
      it(`runs ${expected} for ${packageManager ?? lockfile}`, async () => {
        await fs.writeFile(
          path.join(repoDir, 'package.json'),
          JSON.stringify({ name: 'fixture-app', version: '1.0.0', packageManager, scripts: { test: 'exit 1' } }),
        );
        await fs.writeFile(path.join(repoDir, lockfile), '');

        const result = await runTestPhase();

        assert.equal(result.ok, true, JSON.stringify(result, null, 2));
        assert.match(result.steps[0].output, new RegExp(`^Attempt 1/1\\n\\$ ${expected}\\n`));
        const [, ...args] = expected.split(' ');
        assert.match(
          result.steps[0].output,
          new RegExp(`fake corepack ${args.join(' ')} home=${path.join(workspace, '.corepack')} default-latest=0`),
        );
        assert.match((await readTestOutput(stateDir)) ?? '', /fake corepack/);
      });
    }
  });

  it('fails with the exit code when the repository test suite fails', async () => {
    await writeTestScript('node -e "console.error(\'expected 1 to equal 2\'); process.exit(7)"');

    const result = await runTestPhase();

    assert.equal(result.ok, false);
    assert.equal(result.error, 'test suite failed with exit code 7');
    assert.equal(result.steps[0].exitCode, 7);
    assert.match(result.steps[0].output, /expected 1 to equal 2/);
  });

  it('drops a stale validation failure when the suite fails', async () => {
    await writeValidationFailure(stateDir, 'rescan: still retired');
    await writeTestScript('node -e "process.exit(1)"');

    await runTestPhase();

    assert.equal(await readValidationFailure(stateDir), undefined);
    assert.equal(typeof (await readTestOutput(stateDir)), 'string');
  });

  it('leaves a validation failure in place when the suite passes', async () => {
    await writeValidationFailure(stateDir, 'rescan: still retired');
    await writeTestScript('node -e "process.exit(0)"');

    const result = await runTestPhase();

    assert.equal(result.ok, true);
    assert.equal(await readValidationFailure(stateDir), 'rescan: still retired');
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
