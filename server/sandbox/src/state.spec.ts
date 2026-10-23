import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  clearTestOutput,
  clearValidationFailure,
  readBreakingChanges,
  readTestOutput,
  readValidationFailure,
  writeBreakingChanges,
  writeTestOutput,
  writeValidationFailure,
} from './state.js';

describe('state', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-state-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reads back nothing before anything was written', async () => {
    assert.equal(await readBreakingChanges(root), undefined);
    assert.equal(await readTestOutput(path.join(root, 'missing')), undefined);
    assert.equal(await readValidationFailure(root), undefined);
  });

  it('creates the state directory on first write', async () => {
    const stateDir = path.join(root, 'nested', 'state');

    await writeBreakingChanges(stateDir, '## Breaking\n- removed foo()');

    assert.equal(await readBreakingChanges(stateDir), '## Breaking\n- removed foo()');
  });

  it('keeps breaking changes and test output apart', async () => {
    await writeBreakingChanges(root, 'notes');
    await writeTestOutput(root, 'FAIL src/a.test.js');

    assert.equal(await readBreakingChanges(root), 'notes');
    assert.equal(await readTestOutput(root), 'FAIL src/a.test.js');
  });

  it('keeps a validation failure apart from the test output, and can drop either', async () => {
    await writeTestOutput(root, 'FAIL src/a.test.js');
    await writeValidationFailure(root, 'rescan: still retired');

    assert.equal(await readValidationFailure(root), 'rescan: still retired');
    await clearTestOutput(root);
    assert.equal(await readTestOutput(root), undefined);
    assert.equal(await readValidationFailure(root), 'rescan: still retired');

    await clearValidationFailure(root);
    assert.equal(await readValidationFailure(root), undefined);
  });

  it('overwrites the previous attempt instead of appending', async () => {
    await writeTestOutput(root, 'first attempt');
    await writeTestOutput(root, 'second attempt');

    assert.equal(await readTestOutput(root), 'second attempt');
  });

  it('round-trips non-ASCII output unchanged', async () => {
    await writeTestOutput(root, '✓ passes · ünïcode');

    assert.equal(await readTestOutput(root), '✓ passes · ünïcode');
  });
});
