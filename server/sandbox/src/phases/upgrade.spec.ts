import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { runOrThrow } from '../exec.js';
import { upgrade } from './upgrade.js';
import {
  DEPENDENCY,
  POSTINSTALL_MARKER,
  cloneInto,
  createOrigin,
  isolatedEnv,
  readJson,
  restoreEnv,
  startRegistry,
} from './npm-fixture.spec.js';

describe('upgrade phase', () => {
  let root: string;
  let registry: { server: Server; url: string };
  let savedEnv: NodeJS.ProcessEnv;
  let workspace: string;
  let repoDir: string;
  let pinned: { url: string };
  let rangedDev: { url: string };
  let looseRange: { url: string };

  before(async () => {
    savedEnv = { ...process.env };
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-upgrade-'));
    const home = path.join(root, 'home');
    await fs.mkdir(home);
    registry = await startRegistry(root);
    Object.assign(process.env, isolatedEnv(root, home, registry.url));

    pinned = await createOrigin(root, 'pinned', { name: 'app', version: '1.0.0', dependencies: { [DEPENDENCY]: '1.0.0' } }, true);
    rangedDev = await createOrigin(root, 'ranged-dev', { name: 'app', version: '1.0.0', devDependencies: { [DEPENDENCY]: '^1.0.0' } }, true);
    looseRange = await createOrigin(root, 'loose-range', { name: 'app', version: '1.0.0', dependencies: { [DEPENDENCY]: '>=1.0.0 <2.0.0' } }, true);
  });

  after(async () => {
    restoreEnv(savedEnv);
    registry.server.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  let phaseEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    phaseEnv = { ...process.env };
    workspace = await fs.mkdtemp(path.join(root, 'workspace-'));
    repoDir = path.join(workspace, 'repo');
    Object.assign(process.env, {
      SANDBOX_WORKSPACE: workspace,
      REPO_URL: 'https://github.com/acme/app.git',
      REPO_FULL_NAME: 'acme/app',
      DEPENDENCY_NAME: DEPENDENCY,
      TARGET_VERSION: '2.0.0',
      BRANCH_NAME: `synclab/${DEPENDENCY}-2.0.0`,
      LLM_MODEL: 'gemini-3.1-pro-preview',
    });
    // The upgrade container is never given a token.
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    restoreEnv(phaseEnv);
  });

  /** The install phase has already run by the time upgrade does. */
  async function installed(originUrl: string): Promise<void> {
    await cloneInto(originUrl, repoDir);
    await runOrThrow('npm', ['ci', '--no-audit', '--no-fund'], { cwd: repoDir });
  }

  it('upgrades an exact pin to an exact pin and updates the lockfile and node_modules, without a GitHub token', async () => {
    await installed(pinned.url);

    const result = await upgrade();

    assert.equal(result.phase, 'upgrade');
    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(result.error, undefined);
    assert.deepEqual(result.steps.map((step) => [step.step, step.exitCode]), [['UPGRADE', 0]]);
    assert.ok(
      result.steps[0].output.startsWith(`$ npm install ${DEPENDENCY}@2.0.0 --save-exact --no-audit --no-fund\n`),
      result.steps[0].output,
    );
    const packageJson = await readJson(path.join(repoDir, 'package.json'));
    assert.deepEqual(packageJson.dependencies, { [DEPENDENCY]: '2.0.0' });
    assert.equal(packageJson.devDependencies, undefined);
    const lockfile = await readJson(path.join(repoDir, 'package-lock.json'));
    assert.equal(lockfile.packages[`node_modules/${DEPENDENCY}`].version, '2.0.0');
    const installedPackage = await readJson(path.join(repoDir, 'node_modules', DEPENDENCY, 'package.json'));
    assert.equal(installedPackage.version, '2.0.0');
  });

  it("runs the new release's lifecycle scripts", async () => {
    await installed(pinned.url);

    const result = await upgrade();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(await fs.readFile(path.join(repoDir, 'node_modules', DEPENDENCY, POSTINSTALL_MARKER), 'utf8'), '2.0.0');
  });

  it('keeps a ranged devDependency ranged and in devDependencies, accepting a v-prefixed tag', async () => {
    await installed(rangedDev.url);
    process.env.TARGET_VERSION = 'v2.0.0';

    const result = await upgrade();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.ok(
      result.steps[0].output.startsWith(`$ npm install ${DEPENDENCY}@2.0.0 --save-dev --no-audit --no-fund\n`),
      result.steps[0].output,
    );
    const packageJson = await readJson(path.join(repoDir, 'package.json'));
    assert.deepEqual(packageJson.devDependencies, { [DEPENDENCY]: '^2.0.0' });
    assert.equal(packageJson.dependencies, undefined);
    // The exact target, not 2.1.0, the newest version the new range allows.
    const installedPackage = await readJson(path.join(repoDir, 'node_modules', DEPENDENCY, 'package.json'));
    assert.equal(installedPackage.version, '2.0.0');
  });

  it('turns any other range into a caret range on the target version', async () => {
    await installed(looseRange.url);

    const result = await upgrade();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.ok(
      result.steps[0].output.startsWith(`$ npm install ${DEPENDENCY}@2.0.0 --no-audit --no-fund\n`),
      result.steps[0].output,
    );
    assert.deepEqual((await readJson(path.join(repoDir, 'package.json'))).dependencies, { [DEPENDENCY]: '^2.0.0' });
    const installedPackage = await readJson(path.join(repoDir, 'node_modules', DEPENDENCY, 'package.json'));
    assert.equal(installedPackage.version, '2.0.0');
  });

  it('fails when the target version does not exist, leaving package.json alone', async () => {
    await installed(pinned.url);
    const before = await fs.readFile(path.join(repoDir, 'package.json'), 'utf8');
    process.env.TARGET_VERSION = '9.9.9';

    const result = await upgrade();

    assert.equal(result.ok, false);
    assert.equal(result.error, `could not install ${DEPENDENCY}@9.9.9`);
    assert.deepEqual(result.steps.map((step) => step.step), ['UPGRADE']);
    assert.notEqual(result.steps[0].exitCode, 0);
    assert.equal(await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'), before);
  });

  it('refuses a package that is not a direct dependency without running the package manager', async () => {
    await installed(pinned.url);
    const before = await fs.readFile(path.join(repoDir, 'package.json'), 'utf8');
    process.env.DEPENDENCY_NAME = 'lodash';

    const result = await upgrade();

    assert.equal(result.ok, false);
    assert.equal(result.error, 'lodash is not a direct dependency in package.json, so it cannot be upgraded');
    assert.deepEqual(result.steps, [
      { step: 'UPGRADE', output: 'lodash is not a direct dependency in package.json, so it cannot be upgraded' },
    ]);
    assert.equal(await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'), before);
  });

  describe('for an API change', () => {
    beforeEach(() => {
      Object.assign(process.env, {
        MIGRATION_KIND: 'api_change',
        API_CHANGE: JSON.stringify({
          provider: 'anthropic',
          kind: 'param_removed',
          field: 'top_k',
          evidence: 'top_k is no longer accepted.',
          sourceUrl: 'https://docs.anthropic.com/en/release-notes/api',
        }),
        TARGET_FILES: JSON.stringify(['index.js']),
      });
    });

    it('upgrades the SDK the change needs', async () => {
      await installed(pinned.url);

      const result = await upgrade();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.deepEqual((await readJson(path.join(repoDir, 'package.json'))).dependencies, { [DEPENDENCY]: '2.0.0' });
    });

    it('refuses to run without an SDK to upgrade', async () => {
      delete process.env.DEPENDENCY_NAME;
      delete process.env.TARGET_VERSION;

      await assert.rejects(upgrade(), { message: 'The upgrade phase needs DEPENDENCY_NAME and TARGET_VERSION' });
    });
  });
});
