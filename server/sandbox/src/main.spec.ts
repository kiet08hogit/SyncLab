import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { run } from './exec.js';
import { RESULT_SENTINEL, type PhaseResult } from './result.js';

const MAIN = fileURLToPath(new URL('./main.js', import.meta.url));

const JOB_ENV = {
  REPO_URL: 'https://github.com/acme/widgets.git',
  REPO_FULL_NAME: 'acme/widgets',
  DEPENDENCY_NAME: 'lodash',
  TARGET_VERSION: '4.17.21',
  BRANCH_NAME: 'synclab/lodash-4.17.21',
  LLM_MODEL: 'qwen2.5-coder:14b',
};

function parseResult(output: string): PhaseResult | undefined {
  const line = output.split('\n').find((candidate) => candidate.startsWith(RESULT_SENTINEL));
  return line ? (JSON.parse(line.slice(RESULT_SENTINEL.length)) as PhaseResult) : undefined;
}

describe('main', () => {
  let workspace: string;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-main-'));
    await fs.mkdir(path.join(workspace, 'repo'));
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function writeTestScript(script: string): Promise<void> {
    await fs.writeFile(
      path.join(workspace, 'repo', 'package.json'),
      JSON.stringify({ name: 'fixture-app', version: '1.0.0', private: true, scripts: { test: script } }),
    );
  }

  it('runs the requested phase, prints its result and exits 0 on success', async () => {
    await writeTestScript('node -e "console.log(\'ok\')"');

    const { code, output } = await run(process.execPath, [MAIN, 'test'], {
      env: { ...JOB_ENV, SANDBOX_WORKSPACE: workspace },
    });
    const result = parseResult(output);

    assert.equal(code, 0);
    assert.equal(result?.phase, 'test');
    assert.equal(result?.ok, true);
  });

  it('exits 1 when the phase reports a failure', async () => {
    await writeTestScript('node -e "process.exit(1)"');

    const { code, output } = await run(process.execPath, [MAIN, 'test'], {
      env: { ...JOB_ENV, SANDBOX_WORKSPACE: workspace },
    });
    const result = parseResult(output);

    assert.equal(code, 1);
    assert.equal(result?.ok, false);
    assert.equal(result?.error, 'test suite failed with exit code 1');
  });

  it('turns an exception thrown by the phase into a failed result', async () => {
    const { code, output } = await run(process.execPath, [MAIN, 'test'], {
      env: { ...JOB_ENV, REPO_URL: '', SANDBOX_WORKSPACE: workspace },
    });

    assert.equal(code, 1);
    assert.deepEqual(parseResult(output), {
      phase: 'test',
      ok: false,
      error: 'Missing required environment variable REPO_URL',
      steps: [],
    });
  });

  it('rejects a missing or unknown phase without printing a result', async () => {
    for (const args of [[], ['deploy'], ['toString'], ['constructor'], ['__proto__']]) {
      const { code, output } = await run(process.execPath, [MAIN, ...args], {
        env: { SANDBOX_WORKSPACE: workspace },
      });

      assert.notEqual(code, 0, `phase ${JSON.stringify(args)}`);
      assert.match(output, /Expected one of prepare, refactor, test, publish/, `phase ${JSON.stringify(args)}`);
      assert.equal(parseResult(output), undefined, `phase ${JSON.stringify(args)}`);
    }
  });
});
