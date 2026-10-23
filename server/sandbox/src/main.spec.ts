import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
  LLM_MODEL: 'gemini-3.1-pro-preview',
};

/** Keeps stdout and stderr apart, which exec.run deliberately interleaves. */
function runMain(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MAIN, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

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

  it('rejects a missing, unknown or inherited phase name with exit code 2, on stderr, without a result', async () => {
    for (const args of [[], [''], ['deploy'], ['PREPARE'], ['toString'], ['constructor'], ['__proto__'], ['hasOwnProperty']]) {
      const label = `phase ${JSON.stringify(args)}`;
      const { code, stdout, stderr } = await runMain(args, { SANDBOX_WORKSPACE: workspace });

      assert.equal(code, 2, label);
      assert.equal(
        stderr,
        `Expected one of prepare, install, upgrade, refactor, test, validate, publish, clone, scan, classify but received "${args[0] ?? ''}"\n`,
        label,
      );
      assert.equal(stdout, '', label);
      assert.equal(parseResult(stdout), undefined, label);
      assert.doesNotMatch(stderr, /UnhandledPromiseRejection|at parsePhase/, label);
    }
  });

  it('runs scan with no job settings, since it only reads the clone', async () => {
    const noJob = Object.fromEntries(Object.keys(JOB_ENV).map((name) => [name, '']));
    const { code, stdout, stderr } = await runMain(['scan'], { ...noJob, SANDBOX_WORKSPACE: workspace });
    const result = parseResult(stdout);

    assert.equal(code, 0, stderr);
    assert.equal(result?.phase, 'scan');
    assert.equal(result?.ok, true);
    assert.deepEqual(result?.data?.usages, []);
  });

  it('runs classify with no job settings and reports a missing input as a failed result', async () => {
    const noJob = Object.fromEntries(Object.keys(JOB_ENV).map((name) => [name, '']));
    const { code, stdout } = await runMain(['classify'], { ...noJob, CLASSIFY_INPUT: '' });

    assert.equal(code, 1);
    assert.deepEqual(parseResult(stdout), {
      phase: 'classify',
      ok: false,
      error: 'Missing required environment variable CLASSIFY_INPUT',
      steps: [],
    });
  });

  it('accepts install and upgrade as phases', async () => {
    for (const phase of ['install', 'upgrade'] as const) {
      const { code, stdout, stderr } = await runMain([phase], { ...JOB_ENV, REPO_URL: '', SANDBOX_WORKSPACE: workspace });

      assert.equal(code, 1, `${phase}: ${stderr}`);
      assert.deepEqual(parseResult(stdout), {
        phase,
        ok: false,
        error: 'Missing required environment variable REPO_URL',
        steps: [],
      });
    }
  });
});
