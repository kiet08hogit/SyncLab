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

  it('passes when no check is registered, and clears a stale failure', async () => {
    await writeTestOutput(stateDir, 'all passed');

    const result = await runValidation(stateDir, []);

    assert.equal(result.ok, true);
    assert.equal(result.steps[0].step, 'VALIDATE');
    assert.match(result.steps[0].output, /No validation checks registered/);
    assert.equal(await readValidationFailure(stateDir), undefined);
    assert.equal(await readTestOutput(stateDir), undefined);
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

  it('runs the registered checks, which pass when the context gives them nothing to check', async () => {
    const result = await validate();

    assert.equal(result.ok, true);
    assert.match(result.steps[0].output, /validation check\(s\) passed/);
  });

  it('records each baseline, then hands it to that check on every later run', async () => {
    const seen: unknown[] = [];
    const checks = [
      { name: 'rescan', baseline: async () => ({ hits: 1 }), run: async (b?: unknown) => { seen.push(b); return undefined; } },
      { name: 'schema', run: async (b?: unknown) => { seen.push(b); return undefined; } },
    ];

    const recorded = await recordBaseline(stateDir, checks);
    assert.equal(recorded.ok, true);
    assert.match(String(recorded.data?.baselineDigest), /^[0-9a-f]{64}$/);
    assert.match(recorded.steps[0].output, /baseline of rescan/);

    const result = await runValidation(stateDir, checks, { rescan: { hits: 1 } });
    assert.equal(result.ok, true);
    assert.deepEqual(seen, [{ hits: 1 }, undefined]);
  });

  describe('with the rescan check and a recorded baseline', () => {
    const RETIRED = 'claude-3-opus-20240229';
    const chat = (model: string) =>
      [
        "import Anthropic from '@anthropic-ai/sdk';",
        'const client = new Anthropic();',
        `export const ask = () => client.messages.create({ model: '${model}', max_tokens: 8, messages: [] });`,
      ].join('\n');
    let saved: Record<string, string | undefined>;

    beforeEach(async () => {
      saved = {
        VALIDATE_CONTEXT: process.env.VALIDATE_CONTEXT,
        VALIDATE_BASELINE: process.env.VALIDATE_BASELINE,
        VALIDATE_BASELINE_DIGEST: process.env.VALIDATE_BASELINE_DIGEST,
        MIGRATION_KIND: process.env.MIGRATION_KIND,
        API_CHANGE: process.env.API_CHANGE,
        TARGET_FILES: process.env.TARGET_FILES,
      };
      process.env.MIGRATION_KIND = 'api_change';
      process.env.API_CHANGE = JSON.stringify({
        provider: 'anthropic',
        kind: 'model_retired',
        field: RETIRED,
        evidence: `${RETIRED} is retired.`,
        sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/model-deprecations',
      });
      process.env.TARGET_FILES = JSON.stringify(['src/chat.ts']);
      process.env.VALIDATE_CONTEXT = JSON.stringify({
        rescan: {
          target: { provider: 'anthropic', kind: 'model_retired', operation: null, field: RETIRED },
          removed: [],
        },
      });
      await fs.mkdir(path.join(workspace, 'repo', 'src'), { recursive: true });
      await fs.writeFile(path.join(workspace, 'repo', 'src', 'chat.ts'), chat(RETIRED));
      process.env.VALIDATE_BASELINE = 'true';
      const recorded = await validate();
      assert.equal(recorded.ok, true, JSON.stringify(recorded));
      delete process.env.VALIDATE_BASELINE;
      process.env.VALIDATE_BASELINE_DIGEST = String(recorded.data?.baselineDigest);
    });

    afterEach(() => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('rejects a tree that still sends the retired model, then accepts the fixed one', async () => {
      const rejected = await validate();
      assert.equal(rejected.ok, false);
      assert.equal(rejected.error, `rescan: src/chat.ts (line 3) still sends the retired model ${RETIRED}.`);

      await fs.writeFile(path.join(workspace, 'repo', 'src', 'chat.ts'), chat('claude-opus-4-1'));
      const accepted = await validate();
      assert.equal(accepted.ok, true, JSON.stringify(accepted));
    });

    it('refuses a baseline that repository code changed after it was recorded', async () => {
      await fs.writeFile(
        path.join(stateDir, 'validate-baseline.json'),
        JSON.stringify({ rescan: { files: [], hits: {}, unparsed: [] } }),
      );

      const result = await validate();

      assert.equal(result.ok, false);
      assert.match(result.error ?? '', /baseline recorded before the migration is missing or was changed/);
      assert.equal(await readValidationFailure(stateDir), result.error);
    });

    it('fails the baseline run when a file the impact record does not list sends the retired model', async () => {
      await fs.writeFile(path.join(workspace, 'repo', 'src', 'new.ts'), chat(RETIRED));
      process.env.VALIDATE_BASELINE = 'true';

      await assert.rejects(validate(), /^Error: src\/new\.ts \(line 3\) sends the retired model .*the default branch moved since the scan/);
    });

    it('refuses a baseline that was removed', async () => {
      await fs.rm(path.join(stateDir, 'validate-baseline.json'));

      const result = await validate();

      assert.equal(result.ok, false);
      assert.match(result.error ?? '', /missing or was changed/);
    });
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
