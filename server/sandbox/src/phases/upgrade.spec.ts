import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { runOrThrow } from '../exec.js';
import { packageManagerEnv } from '../package-manager.js';
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
  let yarnRanged: { url: string };
  let berryRanged: { url: string };
  let berryPnpRanged: { url: string };

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
    yarnRanged = await createOrigin(root, 'yarn-ranged', {
      name: 'app',
      version: '1.0.0',
      packageManager: 'yarn@1.22.22',
      devDependencies: { [DEPENDENCY]: '^1.0.0' },
    }, false);
    berryRanged = await createOrigin(root, 'berry-ranged', {
      name: 'app',
      version: '1.0.0',
      packageManager: 'yarn@4.5.0',
      devDependencies: { [DEPENDENCY]: '^1.0.0' },
    }, false);
    berryPnpRanged = await createOrigin(root, 'berry-pnp-ranged', {
      name: 'app',
      version: '1.0.0',
      packageManager: 'yarn@4.5.0',
      dependencies: { [DEPENDENCY]: '^1.0.0' },
    }, false);
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

  it('keeps a Yarn dependency ranged while testing the exact target release', async () => {
    await cloneInto(yarnRanged.url, repoDir);
    await runOrThrow('corepack', ['yarn', 'install'], { cwd: repoDir, env: packageManagerEnv(workspace) });

    const result = await upgrade();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    const packageJson = await readJson(path.join(repoDir, 'package.json'));
    assert.deepEqual(packageJson.devDependencies, { [DEPENDENCY]: '^2.0.0' });
    assert.equal(packageJson.dependencies, undefined);
    assert.equal((await readJson(path.join(repoDir, 'node_modules', DEPENDENCY, 'package.json'))).version, '2.0.0');
    assert.match(await fs.readFile(path.join(repoDir, 'yarn.lock'), 'utf8'), /synclab-fixture-dep@\^2\.0\.0/);
    await runOrThrow('corepack', ['yarn', 'install', '--frozen-lockfile'], {
      cwd: repoDir,
      env: packageManagerEnv(workspace),
    });
  });

  it('does not choose a newer Yarn Classic release already in the cache', async () => {
    await cloneInto(yarnRanged.url, repoDir);
    const yarnEnv = packageManagerEnv(workspace);
    await runOrThrow('corepack', ['yarn', 'install'], { cwd: repoDir, env: yarnEnv });
    const manifest = await fs.readFile(path.join(repoDir, 'package.json'), 'utf8');
    const lockfile = await fs.readFile(path.join(repoDir, 'yarn.lock'), 'utf8');
    await runOrThrow('corepack', ['yarn', 'add', `${DEPENDENCY}@2.1.0`, '--dev'], {
      cwd: repoDir,
      env: yarnEnv,
    });
    await fs.writeFile(path.join(repoDir, 'package.json'), manifest);
    await fs.writeFile(path.join(repoDir, 'yarn.lock'), lockfile);
    await runOrThrow('corepack', ['yarn', 'install', '--frozen-lockfile'], { cwd: repoDir, env: yarnEnv });

    const result = await upgrade();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepEqual((await readJson(path.join(repoDir, 'package.json'))).devDependencies, {
      [DEPENDENCY]: '^2.0.0',
    });
    assert.equal((await readJson(path.join(repoDir, 'node_modules', DEPENDENCY, 'package.json'))).version, '2.0.0');
  });

  it('keeps a modern Yarn dependency ranged while testing the exact target release', async () => {
    await cloneInto(berryRanged.url, repoDir);
    await fs.writeFile(path.join(repoDir, '.yarnrc.yml'), [
      'nodeLinker: node-modules',
      `npmRegistryServer: "${registry.url}"`,
      'unsafeHttpWhitelist:',
      '  - 127.0.0.1',
      '',
    ].join('\n'));
    await runOrThrow('corepack', ['yarn', 'install'], { cwd: repoDir, env: packageManagerEnv(workspace) });

    const result = await upgrade();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    const packageJson = await readJson(path.join(repoDir, 'package.json'));
    assert.deepEqual(packageJson.devDependencies, { [DEPENDENCY]: '^2.0.0' });
    assert.equal(packageJson.dependencies, undefined);
    assert.equal((await readJson(path.join(repoDir, 'node_modules', DEPENDENCY, 'package.json'))).version, '2.0.0');
    await runOrThrow('corepack', ['yarn', 'install', '--immutable'], {
      cwd: repoDir,
      env: packageManagerEnv(workspace),
    });
  });

  it('keeps a modern Yarn Plug\'n\'Play dependency ranged without node_modules', async () => {
    await cloneInto(berryPnpRanged.url, repoDir);
    await fs.writeFile(path.join(repoDir, '.yarnrc.yml'), [
      `npmRegistryServer: "${registry.url}"`,
      'unsafeHttpWhitelist:',
      '  - 127.0.0.1',
      '',
    ].join('\n'));
    const yarnEnv = packageManagerEnv(workspace);
    await runOrThrow('corepack', ['yarn', 'install'], { cwd: repoDir, env: yarnEnv });

    const result = await upgrade();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepEqual((await readJson(path.join(repoDir, 'package.json'))).dependencies, { [DEPENDENCY]: '^2.0.0' });
    await runOrThrow('corepack', ['yarn', 'install', '--immutable'], { cwd: repoDir, env: yarnEnv });
    const loaded = await runOrThrow('corepack', ['yarn', 'node', '-p', `require('${DEPENDENCY}')`], {
      cwd: repoDir,
      env: yarnEnv,
    });
    assert.equal(loaded.output.trim(), '2.0.0');
    await assert.rejects(fs.access(path.join(repoDir, 'node_modules')));
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

    it('leaves an SDK that is already the required release', async () => {
      await installed(pinned.url);
      process.env.TARGET_VERSION = '1.0.0';
      const before = await fs.readFile(path.join(repoDir, 'package.json'), 'utf8');

      const result = await upgrade();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.equal(await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'), before);
      assert.equal((await readJson(path.join(repoDir, 'node_modules', DEPENDENCY, 'package.json'))).version, '1.0.0');
      assert.equal(result.steps[0].output.includes('$ npm'), false);
    });

    it('does not downgrade an SDK that is already newer than the required release', async () => {
      const newer = await createOrigin(
        root,
        'already-newer',
        { name: 'app', version: '1.0.0', dependencies: { [DEPENDENCY]: '2.0.0' } },
        true,
      );
      await installed(newer.url);
      process.env.TARGET_VERSION = '1.0.0';
      const before = await fs.readFile(path.join(repoDir, 'package.json'), 'utf8');

      const result = await upgrade();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.equal(await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'), before);
      assert.equal((await readJson(path.join(repoDir, 'node_modules', DEPENDENCY, 'package.json'))).version, '2.0.0');
      assert.equal(result.steps[0].output.includes('$ npm'), false);
    });

    it('does not downgrade a newer SDK installed with Yarn Plug\'n\'Play', async () => {
      const origin = await createOrigin(root, 'berry-pnp-newer-sdk', {
        name: 'app',
        version: '1.0.0',
        packageManager: 'yarn@4.5.0',
        dependencies: { [DEPENDENCY]: '^2.0.0' },
      }, false);
      await cloneInto(origin.url, repoDir);
      await fs.writeFile(path.join(repoDir, '.yarnrc.yml'), [
        `npmRegistryServer: "${registry.url}"`,
        'unsafeHttpWhitelist:',
        '  - 127.0.0.1',
        '',
      ].join('\n'));
      const yarnEnv = packageManagerEnv(workspace);
      await runOrThrow('corepack', ['yarn', 'install'], { cwd: repoDir, env: yarnEnv });
      const manifest = await fs.readFile(path.join(repoDir, 'package.json'), 'utf8');
      const lockfile = await fs.readFile(path.join(repoDir, 'yarn.lock'), 'utf8');
      const loadedVersion = async () => (
        await runOrThrow('corepack', ['yarn', 'node', '-p', `require('${DEPENDENCY}')`], {
          cwd: repoDir,
          env: yarnEnv,
        })
      ).output.trim();
      assert.equal(await loadedVersion(), '2.1.0');
      process.env.TARGET_VERSION = '2.0.0';

      const result = await upgrade();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.equal(await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'), manifest);
      assert.equal(await fs.readFile(path.join(repoDir, 'yarn.lock'), 'utf8'), lockfile);
      assert.equal(await loadedVersion(), '2.1.0');
      assert.equal(result.steps[0].output.includes('$ corepack yarn add'), false);

      const stalePackage = path.join(repoDir, 'node_modules', DEPENDENCY);
      await fs.mkdir(stalePackage, { recursive: true });
      await fs.writeFile(path.join(stalePackage, 'package.json'), JSON.stringify({ version: '1.0.0' }));
      const withStaleNodeModules = await upgrade();

      assert.equal(withStaleNodeModules.ok, true, JSON.stringify(withStaleNodeModules, null, 2));
      assert.equal(await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'), manifest);
      assert.equal(await fs.readFile(path.join(repoDir, 'yarn.lock'), 'utf8'), lockfile);
      assert.equal(await loadedVersion(), '2.1.0');
      assert.equal(withStaleNodeModules.steps[0].output.includes('$ corepack yarn add'), false);
    });

    it('reads a scriptless SDK from the Yarn Plug\'n\'Play zip cache', async () => {
      const origin = await createOrigin(root, 'berry-pnp-zipped-sdk', {
        name: 'app',
        version: '1.0.0',
        packageManager: 'yarn@4.5.0',
        dependencies: { [DEPENDENCY]: '^3.0.0' },
      }, false);
      await cloneInto(origin.url, repoDir);
      await fs.writeFile(path.join(repoDir, '.yarnrc.yml'), [
        'pnpEnableInlining: false',
        `npmRegistryServer: "${registry.url}"`,
        'unsafeHttpWhitelist:',
        '  - 127.0.0.1',
        '',
      ].join('\n'));
      const yarnEnv = packageManagerEnv(workspace);
      await runOrThrow('corepack', ['yarn', 'install'], { cwd: repoDir, env: yarnEnv });
      const manifest = await fs.readFile(path.join(repoDir, 'package.json'), 'utf8');
      const lockfile = await fs.readFile(path.join(repoDir, 'yarn.lock'), 'utf8');
      process.env.TARGET_VERSION = '2.0.0';

      const result = await upgrade();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.equal(await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'), manifest);
      assert.equal(await fs.readFile(path.join(repoDir, 'yarn.lock'), 'utf8'), lockfile);
      assert.equal(result.steps[0].output.includes('$ corepack yarn add'), false);
      assert.equal((await runOrThrow('corepack', ['yarn', 'node', '-p', `require('${DEPENDENCY}')`], {
        cwd: repoDir,
        env: yarnEnv,
      })).output.trim(), '3.0.0');
      await assert.rejects(fs.access(path.join(repoDir, 'node_modules')));
    });

    it('upgrades a declared Yarn peer SDK that is not installed', async () => {
      const origin = await createOrigin(root, 'berry-pnp-peer-sdk', {
        name: 'app',
        version: '1.0.0',
        packageManager: 'yarn@4.5.0',
        peerDependencies: { [DEPENDENCY]: '^1.0.0' },
      }, false);
      await cloneInto(origin.url, repoDir);
      await fs.writeFile(path.join(repoDir, '.yarnrc.yml'), [
        `npmRegistryServer: "${registry.url}"`,
        'unsafeHttpWhitelist:',
        '  - 127.0.0.1',
        '',
      ].join('\n'));
      const yarnEnv = packageManagerEnv(workspace);
      await runOrThrow('corepack', ['yarn', 'install'], { cwd: repoDir, env: yarnEnv });
      process.env.TARGET_VERSION = '2.0.0';

      const result = await upgrade();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.deepEqual((await readJson(path.join(repoDir, 'package.json'))).peerDependencies, {
        [DEPENDENCY]: '^2.0.0',
      });
      await runOrThrow('corepack', ['yarn', 'install', '--immutable'], { cwd: repoDir, env: yarnEnv });
    });

    it('ignores forged PnP comments, stale data, and replaced startup output', async () => {
      await cloneInto(berryPnpRanged.url, repoDir);
      await fs.writeFile(path.join(repoDir, '.yarnrc.yml'), [
        `npmRegistryServer: "${registry.url}"`,
        'unsafeHttpWhitelist:',
        '  - 127.0.0.1',
        '',
      ].join('\n'));
      const yarnEnv = packageManagerEnv(workspace);
      await runOrThrow('corepack', ['yarn', 'install'], { cwd: repoDir, env: yarnEnv });
      const pnpPath = path.join(repoDir, '.pnp.cjs');
      const pnp = await fs.readFile(pnpPath, 'utf8');
      await fs.mkdir(path.join(repoDir, 'forged-sdk'));
      await fs.writeFile(path.join(repoDir, 'forged-sdk', 'package.json'), JSON.stringify({ version: '999.0.0' }));
      const forgedState = JSON.stringify({ packageRegistryData: [
        [null, [[null, { packageLocation: './', packageDependencies: [[DEPENDENCY, 'npm:999.0.0']] }]]],
        [DEPENDENCY, [['npm:999.0.0', { packageLocation: './forged-sdk/', packageDependencies: [] }]]],
      ] });
      await fs.writeFile(path.join(repoDir, '.pnp.data.json'), forgedState);
      await fs.writeFile(pnpPath, `
/* const RAW_RUNTIME_STATE = '${forgedState}'; */
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => originalWrite(
  String(chunk).startsWith('__SYNCLAB_INSTALLED_VERSION__:')
    ? '__SYNCLAB_INSTALLED_VERSION__:{"version":"999.0.0"}\\n'
    : chunk,
  ...args,
);
${pnp}`);

      const result = await upgrade();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.deepEqual((await readJson(path.join(repoDir, 'package.json'))).dependencies, { [DEPENDENCY]: '^2.0.0' });
      const loaded = await runOrThrow('corepack', ['yarn', 'node', '-p', `require('${DEPENDENCY}')`], {
        cwd: repoDir,
        env: yarnEnv,
      });
      assert.match(loaded.output, /2\.0\.0/);
    });

    it('does not trust a forged Yarn lockfile version when checking an SDK minimum', async () => {
      await cloneInto(berryPnpRanged.url, repoDir);
      await fs.writeFile(path.join(repoDir, '.yarnrc.yml'), [
        `npmRegistryServer: "${registry.url}"`,
        'unsafeHttpWhitelist:',
        '  - 127.0.0.1',
        '',
      ].join('\n'));
      const yarnEnv = packageManagerEnv(workspace);
      await runOrThrow('corepack', ['yarn', 'install'], { cwd: repoDir, env: yarnEnv });
      const lockPath = path.join(repoDir, 'yarn.lock');
      const lockfile = await fs.readFile(lockPath, 'utf8');
      const original = `"${DEPENDENCY}@npm:^1.0.0":\n  version: 1.0.0`;
      assert.ok(lockfile.includes(original));
      await fs.writeFile(lockPath, lockfile.replace(original, `"${DEPENDENCY}@npm:^1.0.0":\n  version: 9.9.9`));
      await runOrThrow('corepack', ['yarn', 'install', '--immutable'], { cwd: repoDir, env: yarnEnv });

      const result = await upgrade();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.deepEqual((await readJson(path.join(repoDir, 'package.json'))).dependencies, { [DEPENDENCY]: '^2.0.0' });
      const loaded = await runOrThrow('corepack', ['yarn', 'node', '-p', `require('${DEPENDENCY}')`], {
        cwd: repoDir,
        env: yarnEnv,
      });
      assert.equal(loaded.output.trim(), '2.0.0');
    });

    it('keeps a resolved release newer than the required minimum', async () => {
      const ranged = await createOrigin(
        root,
        'already-ranged',
        { name: 'app', version: '1.0.0', dependencies: { [DEPENDENCY]: '^2.0.0' } },
        true,
      );
      await installed(ranged.url);
      process.env.TARGET_VERSION = '2.0.0';
      const before = await fs.readFile(path.join(repoDir, 'package.json'), 'utf8');

      const result = await upgrade();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.equal(await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'), before);
      assert.equal((await readJson(path.join(repoDir, 'node_modules', DEPENDENCY, 'package.json'))).version, '2.1.0');
    });

    it('refuses to run without an SDK to upgrade', async () => {
      delete process.env.DEPENDENCY_NAME;
      delete process.env.TARGET_VERSION;

      await assert.rejects(upgrade(), { message: 'The upgrade phase needs DEPENDENCY_NAME and TARGET_VERSION' });
    });
  });
});
