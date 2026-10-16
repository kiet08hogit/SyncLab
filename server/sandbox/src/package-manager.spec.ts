import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  addCommand,
  detectPackageManager,
  installCommand,
  packageManagerEnv,
  testCommand,
  type DependencySection,
  type PackageManager,
} from './package-manager.js';

describe('detectPackageManager', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-pm-'));
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  async function setup(packageJson: Record<string, unknown>, files: string[] = []): Promise<PackageManager> {
    await fs.writeFile(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'app', ...packageJson }));
    for (const file of files) {
      await fs.writeFile(path.join(repoDir, file), '');
    }
    return detectPackageManager(repoDir);
  }

  it('defaults to npm without a lockfile when there is neither a packageManager field nor a lockfile', async () => {
    assert.deepEqual(await setup({}), { name: 'npm', berry: false, hasLockfile: false });
  });

  it('detects each lockfile', async () => {
    const cases: [string, PackageManager][] = [
      ['package-lock.json', { name: 'npm', berry: false, hasLockfile: true }],
      ['npm-shrinkwrap.json', { name: 'npm', berry: false, hasLockfile: true }],
      ['pnpm-lock.yaml', { name: 'pnpm', berry: false, hasLockfile: true }],
      ['yarn.lock', { name: 'yarn', berry: false, hasLockfile: true }],
    ];
    for (const [lockfile, expected] of cases) {
      await fs.rm(repoDir, { recursive: true, force: true });
      await fs.mkdir(repoDir);
      assert.deepEqual(await setup({}, [lockfile]), expected, lockfile);
    }
  });

  it('prefers pnpm-lock.yaml, then yarn.lock, then the npm lockfiles when several exist', async () => {
    assert.equal((await setup({}, ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'])).name, 'pnpm');
    await fs.rm(path.join(repoDir, 'pnpm-lock.yaml'));
    assert.equal((await detectPackageManager(repoDir)).name, 'yarn');
  });

  it('lets the packageManager field beat a lockfile', async () => {
    assert.deepEqual(await setup({ packageManager: 'pnpm@9.1.0' }, ['package-lock.json']), {
      name: 'pnpm',
      berry: false,
      hasLockfile: false,
    });
  });

  it("reports the declared manager's own lockfile", async () => {
    assert.deepEqual(await setup({ packageManager: 'npm@10.8.0' }, ['yarn.lock', 'npm-shrinkwrap.json']), {
      name: 'npm',
      berry: false,
      hasLockfile: true,
    });
  });

  it('detects Yarn classic from a packageManager major of 1', async () => {
    assert.deepEqual(await setup({ packageManager: 'yarn@1.22.22' }, ['yarn.lock']), {
      name: 'yarn',
      berry: false,
      hasLockfile: true,
    });
  });

  it('detects Yarn berry from a packageManager major of 2 or more', async () => {
    assert.deepEqual(await setup({ packageManager: 'yarn@4.5.0+sha512.abc' }), {
      name: 'yarn',
      berry: true,
      hasLockfile: false,
    });
    assert.equal((await setup({ packageManager: 'yarn@2.4.3' })).berry, true);
  });

  it('detects Yarn berry from .yarnrc.yml when the version is not declared', async () => {
    assert.deepEqual(await setup({}, ['yarn.lock', '.yarnrc.yml']), { name: 'yarn', berry: true, hasLockfile: true });
  });

  it('never marks npm or pnpm as berry, even next to a .yarnrc.yml', async () => {
    assert.equal((await setup({}, ['.yarnrc.yml'])).berry, false);
    assert.equal((await setup({ packageManager: 'pnpm@9.0.0' }, ['.yarnrc.yml'])).berry, false);
  });

  it('falls back to the lockfile when the packageManager value is malformed', async () => {
    for (const packageManager of ['bun@1.1.0', 'pnpm', 'Yarn@4.0.0', ' yarn@4.0.0', 42, { name: 'pnpm' }, null]) {
      assert.deepEqual(
        await setup({ packageManager }, ['yarn.lock']),
        { name: 'yarn', berry: false, hasLockfile: true },
        JSON.stringify(packageManager),
      );
    }
  });

  it('rejects a repository without a package.json', async () => {
    await assert.rejects(detectPackageManager(repoDir), { code: 'ENOENT' });
  });
});

const npm: PackageManager = { name: 'npm', berry: false, hasLockfile: true };
const npmUnlocked: PackageManager = { ...npm, hasLockfile: false };
const pnpm: PackageManager = { name: 'pnpm', berry: false, hasLockfile: true };
const pnpmUnlocked: PackageManager = { ...pnpm, hasLockfile: false };
const yarn: PackageManager = { name: 'yarn', berry: false, hasLockfile: true };
const yarnUnlocked: PackageManager = { ...yarn, hasLockfile: false };
const berry: PackageManager = { name: 'yarn', berry: true, hasLockfile: true };
const berryUnlocked: PackageManager = { ...berry, hasLockfile: false };

describe('installCommand', () => {
  it('honours an npm lockfile with npm ci, and creates one with npm install', () => {
    assert.deepEqual(installCommand(npm), { command: 'npm', args: ['ci', '--no-audit', '--no-fund'] });
    assert.deepEqual(installCommand(npmUnlocked), { command: 'npm', args: ['install', '--no-audit', '--no-fund'] });
  });

  it('runs pnpm through corepack with a frozen lockfile when there is one', () => {
    assert.deepEqual(installCommand(pnpm), { command: 'corepack', args: ['pnpm', 'install', '--frozen-lockfile'] });
    assert.deepEqual(installCommand(pnpmUnlocked), { command: 'corepack', args: ['pnpm', 'install'] });
  });

  it('uses --frozen-lockfile for Yarn classic and --immutable for Yarn berry', () => {
    assert.deepEqual(installCommand(yarn), { command: 'corepack', args: ['yarn', 'install', '--frozen-lockfile'] });
    assert.deepEqual(installCommand(berry), { command: 'corepack', args: ['yarn', 'install', '--immutable'] });
  });

  it('runs a plain yarn install without a lockfile', () => {
    assert.deepEqual(installCommand(yarnUnlocked), { command: 'corepack', args: ['yarn', 'install'] });
    assert.deepEqual(installCommand(berryUnlocked), { command: 'corepack', args: ['yarn', 'install'] });
  });

  it('never skips lifecycle scripts', () => {
    for (const pm of [npm, npmUnlocked, pnpm, pnpmUnlocked, yarn, yarnUnlocked, berry, berryUnlocked]) {
      assert.ok(!installCommand(pm).args.includes('--ignore-scripts'), JSON.stringify(pm));
    }
  });
});

describe('addCommand', () => {
  const sections: DependencySection[] = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

  it('keeps each section with npm', () => {
    const expected: Record<DependencySection, string[]> = {
      dependencies: [],
      devDependencies: ['--save-dev'],
      optionalDependencies: ['--save-optional'],
      peerDependencies: ['--save-peer'],
    };
    for (const section of sections) {
      assert.deepEqual(
        addCommand(npm, 'lodash@^4.17.21', section, false),
        { command: 'npm', args: ['install', 'lodash@^4.17.21', ...expected[section], '--no-audit', '--no-fund'] },
        section,
      );
    }
  });

  it('keeps each section with pnpm', () => {
    const expected: Record<DependencySection, string[]> = {
      dependencies: [],
      devDependencies: ['--save-dev'],
      optionalDependencies: ['--save-optional'],
      peerDependencies: ['--save-peer'],
    };
    for (const section of sections) {
      assert.deepEqual(
        addCommand(pnpm, 'lodash@^4.17.21', section, false),
        { command: 'corepack', args: ['pnpm', 'add', 'lodash@^4.17.21', ...expected[section]] },
        section,
      );
    }
  });

  it('keeps each section with Yarn classic and Yarn berry', () => {
    const expected: Record<DependencySection, string[]> = {
      dependencies: [],
      devDependencies: ['--dev'],
      optionalDependencies: ['--optional'],
      peerDependencies: ['--peer'],
    };
    for (const pm of [yarn, berry]) {
      for (const section of sections) {
        assert.deepEqual(
          addCommand(pm, 'lodash@^4.17.21', section, false),
          { command: 'corepack', args: ['yarn', 'add', 'lodash@^4.17.21', ...expected[section]] },
          `${section} berry=${pm.berry}`,
        );
      }
    }
  });

  it('adds the exact flag after the section flag for an exact pin', () => {
    assert.deepEqual(addCommand(npm, 'lodash@4.17.21', 'devDependencies', true), {
      command: 'npm',
      args: ['install', 'lodash@4.17.21', '--save-dev', '--save-exact', '--no-audit', '--no-fund'],
    });
    assert.deepEqual(addCommand(pnpm, 'lodash@4.17.21', 'dependencies', true), {
      command: 'corepack',
      args: ['pnpm', 'add', 'lodash@4.17.21', '--save-exact'],
    });
    assert.deepEqual(addCommand(yarn, 'lodash@4.17.21', 'optionalDependencies', true), {
      command: 'corepack',
      args: ['yarn', 'add', 'lodash@4.17.21', '--optional', '--exact'],
    });
    assert.deepEqual(addCommand(berry, 'lodash@4.17.21', 'peerDependencies', true), {
      command: 'corepack',
      args: ['yarn', 'add', 'lodash@4.17.21', '--peer', '--exact'],
    });
  });

  it('does not depend on whether there is a lockfile', () => {
    for (const [locked, unlocked] of [[npm, npmUnlocked], [pnpm, pnpmUnlocked], [yarn, yarnUnlocked], [berry, berryUnlocked]]) {
      assert.deepEqual(addCommand(locked, 'a@1.0.0', 'dependencies', true), addCommand(unlocked, 'a@1.0.0', 'dependencies', true));
    }
  });

  it('never skips lifecycle scripts', () => {
    for (const pm of [npm, pnpm, yarn, berry]) {
      assert.ok(!addCommand(pm, 'a@1.0.0', 'dependencies', false).args.includes('--ignore-scripts'), pm.name);
    }
  });
});

describe('testCommand', () => {
  it('runs npm directly and pnpm and yarn through corepack', () => {
    assert.deepEqual(testCommand(npm), { command: 'npm', args: ['test'] });
    assert.deepEqual(testCommand(pnpmUnlocked), { command: 'corepack', args: ['pnpm', 'test'] });
    assert.deepEqual(testCommand(yarn), { command: 'corepack', args: ['yarn', 'test'] });
    assert.deepEqual(testCommand(berry), { command: 'corepack', args: ['yarn', 'test'] });
  });
});

describe('packageManagerEnv', () => {
  it('keeps corepack and the Yarn global folder on the workspace volume and never resolves latest', () => {
    const workspace = path.join(os.tmpdir(), 'job-workspace');

    const env = packageManagerEnv(workspace);

    assert.equal(env.COREPACK_HOME, path.join(workspace, '.corepack'));
    assert.equal(env.YARN_GLOBAL_FOLDER, path.join(workspace, '.yarn-global'));
    assert.equal(env.COREPACK_DEFAULT_TO_LATEST, '0');
    assert.equal(env.COREPACK_ENABLE_DOWNLOAD_PROMPT, '0');
    assert.equal(env.YARN_ENABLE_TELEMETRY, '0');
    for (const name of ['COREPACK_HOME', 'YARN_GLOBAL_FOLDER']) {
      assert.ok(env[name]!.startsWith(`${workspace}${path.sep}`), name);
    }
  });
});
