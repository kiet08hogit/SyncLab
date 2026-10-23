import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readTestOutput, readValidationFailure, writeTestOutput } from '../state.js';
import { loadChecks } from '../validate/load-checks.js';
import { recordBaseline, runValidation, validate } from './validate.js';

describe('validate', () => {
  let workspace: string;
  let stateDir: string;
  let previousWorkspace: string | undefined;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-validate-'));
    stateDir = path.join(workspace, 'state');
    previousWorkspace = process.env.SANDBOX_WORKSPACE;
    process.env.SANDBOX_WORKSPACE = workspace;
  });

  afterEach(async () => {
    if (previousWorkspace === undefined) {
      delete process.env.SANDBOX_WORKSPACE;
    } else {
      process.env.SANDBOX_WORKSPACE = previousWorkspace;
    }
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('passes when the worker sent nothing to check, and clears a stale failure', async () => {
    await writeTestOutput(stateDir, 'all passed');

    const result = await validate();

    assert.equal(result.ok, true);
    assert.equal(result.steps[0].step, 'VALIDATE');
    assert.match(result.steps[0].output, /validation check\(s\) passed/);
    assert.equal(await readValidationFailure(stateDir), undefined);
    assert.equal(await readTestOutput(stateDir), undefined);
  });

  it('records each baseline, then hands it to that check on every later run', async () => {
    const seen: unknown[] = [];
    const checks = [
      { name: 'rescan', baseline: async () => ({ hits: 1 }), run: async (b?: unknown) => { seen.push(b); return undefined; } },
      { name: 'schema', run: async (b?: unknown) => { seen.push(b); return undefined; } },
    ];

    const recorded = await recordBaseline(checks);
    assert.equal(recorded.ok, true);
    assert.deepEqual(recorded.data, { baselines: { rescan: { hits: 1 } } });
    assert.match(recorded.steps[0].output, /baseline of rescan/);

    const result = await runValidation(
      stateDir,
      checks,
      JSON.parse(JSON.stringify((recorded.data as { baselines: Record<string, unknown> }).baselines)),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(seen, [{ hits: 1 }, undefined]);
  });

  it('saves each failed check for the next refactor attempt', async () => {
    await writeTestOutput(stateDir, 'Tests: 4 passed');

    const result = await runValidation(stateDir, [
      { name: 'rescan', run: async () => 'still sends claude-3-opus-20240229' },
      { name: 'schema', run: async () => undefined },
      { name: 'typecheck', run: async () => { throw new Error('tsc exited 2'); } },
    ]);

    assert.equal(result.ok, false);
    assert.equal(
      result.error,
      'rescan: still sends claude-3-opus-20240229\ntypecheck: tsc exited 2',
    );
    assert.equal(await readValidationFailure(stateDir), result.error);
    assert.equal(await readTestOutput(stateDir), undefined);
  });

  it('loads a check from its own file and ignores anything else in the directory', async () => {
    const dir = path.join(workspace, 'checks');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'notes.txt'), 'not a check');
    await fs.writeFile(
      path.join(dir, 'rescan.js'),
      "export const check = { name: 'rescan', run: async () => 'still retired' };\n",
    );
    await fs.writeFile(path.join(dir, 'helper.js'), 'export const check = undefined;\n');
    await fs.writeFile(path.join(dir, 'broken.js'), 'throw new Error("cannot load");\n');

    const checks = await loadChecks(dir);
    const reasons: string[] = [];
    for (const check of checks) {
      reasons.push(`${check.name}: ${await check.run()}`);
    }

    assert.deepEqual(reasons.sort(), [
      'broken: cannot load',
      'rescan: still retired',
    ]);
  });
});
