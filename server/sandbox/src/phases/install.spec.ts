import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { runOrThrow } from '../exec.js';
import { install } from './install.js';
import {
  DEPENDENCY,
  POSTINSTALL_MARKER,
  cloneInto,
  createOrigin,
  exists,
  isolatedEnv,
  readJson,
  restoreEnv,
  startRegistry,
} from './npm-fixture.spec.js';

describe('install phase', () => {
  let root: string;
  let registry: { server: Server; url: string };
  let savedEnv: NodeJS.ProcessEnv;
  let workspace: string;
  let repoDir: string;
  let locked: { url: string };
  let unlocked: { url: string };
  let broken: { url: string };

  before(async () => {
    savedEnv = { ...process.env };
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-install-'));
    const home = path.join(root, 'home');
    await fs.mkdir(home);
    registry = await startRegistry(root);
    Object.assign(process.env, isolatedEnv(root, home, registry.url));

    locked = await createOrigin(root, 'locked', { name: 'app', version: '1.0.0', dependencies: { [DEPENDENCY]: '1.0.0' } }, true);
    unlocked = await createOrigin(root, 'unlocked', { name: 'app', version: '1.0.0', dependencies: { [DEPENDENCY]: '^1.0.0' } }, false);
    broken = await createOrigin(
      root,
      'broken',
      { name: 'app', version: '1.0.0', dependencies: { [DEPENDENCY]: '1.0.0', 'synclab-missing-package': '1.0.0' } },
      false,
    );
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
    // The install container is never given a token.
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    restoreEnv(phaseEnv);
  });

  it('installs a locked repository with npm ci, without a GitHub token', async () => {
    await cloneInto(locked.url, repoDir);
    const lockfileBefore = await fs.readFile(path.join(repoDir, 'package-lock.json'), 'utf8');

    const result = await install();

    assert.equal(result.phase, 'install');
    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].step, 'INSTALL');
    assert.equal(result.steps[0].exitCode, 0);
    assert.ok(result.steps[0].output.startsWith('$ npm ci --no-audit --no-fund\n'), result.steps[0].output);
    const installed = await readJson(path.join(repoDir, 'node_modules', DEPENDENCY, 'package.json'));
    assert.equal(installed.version, '1.0.0');
    assert.equal(await fs.readFile(path.join(repoDir, 'package-lock.json'), 'utf8'), lockfileBefore);
  });

  it("runs the dependencies' lifecycle scripts", async () => {
    await cloneInto(locked.url, repoDir);

    const result = await install();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(await fs.readFile(path.join(repoDir, 'node_modules', DEPENDENCY, POSTINSTALL_MARKER), 'utf8'), '1.0.0');
  });

  it('installs with npm install and writes a lockfile when the repository has none', async () => {
    await cloneInto(unlocked.url, repoDir);

    const result = await install();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.ok(result.steps[0].output.startsWith('$ npm install --no-audit --no-fund\n'), result.steps[0].output);
    const lockfile = await readJson(path.join(repoDir, 'package-lock.json'));
    assert.equal(lockfile.packages[`node_modules/${DEPENDENCY}`].version, '1.0.0');
    assert.equal(await exists(path.join(repoDir, 'node_modules', DEPENDENCY, POSTINSTALL_MARKER)), true);
  });

  it('installs every impacted package when only one depends on the SDK', async () => {
    const packages = [
      { directory: 'server/api', manifest: { name: 'api', version: '1.0.0' } },
      { directory: 'server/sandbox', manifest: { name: 'sandbox', version: '1.0.0', dependencies: { [DEPENDENCY]: '1.0.0' } } },
      { directory: 'web', manifest: { name: 'web', version: '1.0.0' } },
    ];
    for (const { directory, manifest } of packages) {
      const packageDir = path.join(repoDir, directory);
      await fs.mkdir(path.join(packageDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify(manifest));
      await fs.writeFile(path.join(packageDir, 'src', 'client.ts'), 'export {}\n');
      await runOrThrow('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: packageDir });
      await fs.rm(path.join(packageDir, 'node_modules'), { recursive: true, force: true });
    }
    Object.assign(process.env, {
      MIGRATION_KIND: 'api_change',
      API_CHANGE: JSON.stringify({
        provider: 'anthropic',
        kind: 'param_removed',
        field: 'top_k',
        evidence: 'top_k is no longer accepted.',
        sourceUrl: 'https://docs.anthropic.com/en/release-notes/api',
      }),
      TARGET_FILES: JSON.stringify([
        'server/api/src/client.ts',
        'server/sandbox/src/client.ts',
        'web/src/client.ts',
      ]),
    });

    const result = await install();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepEqual(result.steps.map((step) => [step.step, step.exitCode]), [
      ['INSTALL', 0],
      ['INSTALL', 0],
      ['INSTALL', 0],
    ]);
    assert.match(result.steps[0].output, /server\/api/);
    assert.match(result.steps[1].output, /server\/sandbox/);
    assert.match(result.steps[2].output, /web/);
    assert.equal(
      (await readJson(path.join(repoDir, 'server', 'sandbox', 'node_modules', DEPENDENCY, 'package.json'))).version,
      '1.0.0',
    );
    assert.equal(await exists(path.join(repoDir, 'server', 'api', 'node_modules', DEPENDENCY)), false);
    assert.equal(await exists(path.join(repoDir, 'web', 'node_modules', DEPENDENCY)), false);
  });

  it('fails with the install output when dependencies cannot be installed', async () => {
    await cloneInto(broken.url, repoDir);

    const result = await install();

    assert.equal(result.ok, false);
    assert.equal(result.error, 'dependency install failed');
    assert.equal(result.data, undefined);
    assert.deepEqual(result.steps.map((step) => step.step), ['INSTALL']);
    assert.notEqual(result.steps[0].exitCode, 0);
    assert.match(result.steps[0].output, /synclab-missing-package/);
  });
});
