import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { runOrThrow } from '../exec.js';
import { readBreakingChanges } from '../state.js';
import { prepare } from './prepare.js';

const DEPENDENCY = 'synclab-fixture-dep';
const TOKEN = 'ghs_preparetoken';
const GITHUB_API = 'https://github.test/api';

function restoreEnv(saved: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(process.env)) {
    if (!(name in saved)) {
      delete process.env[name];
    }
  }
  Object.assign(process.env, saved);
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await runOrThrow('git', args, { cwd })).output.trim();
}

async function readJson(filePath: string): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

/**
 * npm runs as a child process, so the registry has to be a real server. It
 * serves a single package with versions 1.0.0 and 2.0.0.
 */
async function startRegistry(root: string): Promise<{ server: Server; url: string }> {
  const tarballs = new Map<string, Buffer>();
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    if (url === `/${DEPENDENCY}`) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(packument));
      return;
    }
    const tarball = tarballs.get(url);
    if (tarball) {
      response.setHeader('content-type', 'application/octet-stream');
      response.end(tarball);
      return;
    }
    response.statusCode = 404;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const versions: Record<string, unknown> = {};
  for (const version of ['1.0.0', '2.0.0']) {
    const packageDir = path.join(root, `pkg-${version}`, 'package');
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name: DEPENDENCY, version }));
    await fs.writeFile(path.join(packageDir, 'index.js'), `module.exports = '${version}';\n`);
    const tarballPath = path.join(root, `${DEPENDENCY}-${version}.tgz`);
    await runOrThrow('tar', ['-czf', tarballPath, '-C', path.dirname(packageDir), 'package']);
    const tarball = await fs.readFile(tarballPath);
    const tarballUrl = `/tarballs/${DEPENDENCY}-${version}.tgz`;
    tarballs.set(tarballUrl, tarball);
    versions[version] = {
      name: DEPENDENCY,
      version,
      dist: {
        tarball: `${url}${tarballUrl}`,
        shasum: createHash('sha1').update(tarball).digest('hex'),
        integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
      },
    };
  }
  const packument = { name: DEPENDENCY, 'dist-tags': { latest: '2.0.0' }, versions };

  return { server, url };
}

interface Call {
  url: string;
  headers: Headers;
}

describe('prepare phase', () => {
  const originalFetch = globalThis.fetch;
  let root: string;
  let registry: { server: Server; url: string };
  let savedEnv: NodeJS.ProcessEnv;
  let home: string;
  let workspace: string;
  let calls: Call[];
  let releaseBody: string | undefined;

  async function createOrigin(
    name: string,
    packageJson: Record<string, unknown>,
    withLockfile: boolean,
  ): Promise<{ url: string; headSha: string }> {
    const seed = path.join(root, `${name}-seed`);
    const bare = path.join(root, `${name}.git`);
    await fs.mkdir(seed);
    await fs.writeFile(path.join(seed, 'package.json'), JSON.stringify(packageJson, null, 2));
    await fs.writeFile(path.join(seed, '.gitignore'), 'node_modules\n');
    if (withLockfile) {
      await runOrThrow('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: seed });
    }
    await git(seed, 'init', '--initial-branch=main');
    await git(seed, 'add', '--all');
    await git(seed, 'commit', '-m', 'initial');
    await git(root, 'init', '--bare', '--initial-branch=main', bare);
    await git(seed, 'push', bare, 'main');
    return { url: pathToFileURL(bare).href, headSha: await git(seed, 'rev-parse', 'HEAD') };
  }

  before(async () => {
    savedEnv = { ...process.env };
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-prepare-'));
    home = path.join(root, 'home');
    await fs.mkdir(home);
    registry = await startRegistry(root);

    // Isolate git and npm from the developer's home directory and the public registry.
    Object.assign(process.env, {
      HOME: home,
      GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Seed',
      GIT_AUTHOR_EMAIL: 'seed@example.com',
      GIT_COMMITTER_NAME: 'Seed',
      GIT_COMMITTER_EMAIL: 'seed@example.com',
      npm_config_registry: `${registry.url}/`,
      npm_config_cache: path.join(root, 'npm-cache'),
      npm_config_userconfig: path.join(home, '.npmrc'),
      npm_config_update_notifier: 'false',
    });
  });

  after(async () => {
    restoreEnv(savedEnv);
    registry.server.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  let jobEnvKeys: string[] = [];

  function setJobEnv(env: Record<string, string>): void {
    jobEnvKeys = Object.keys(env);
    Object.assign(process.env, env);
  }

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(root, 'workspace-'));
    calls = [];
    releaseBody = '## Breaking changes\n- default export removed';

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push({ url, headers: new Headers(init?.headers) });

      if (url === `https://registry.npmjs.org/${DEPENDENCY}`) {
        return Response.json({ repository: { url: 'git+https://github.com/acme/fixture-dep.git' } });
      }
      if (url === `${GITHUB_API}/repos/acme/fixture-dep/releases/tags/2.0.0` && releaseBody) {
        return Response.json({ body: releaseBody });
      }
      return Response.json({ message: 'Not Found' }, { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const name of jobEnvKeys) {
      delete process.env[name];
    }
  });

  function jobEnv(repoUrl: string, overrides: Record<string, string> = {}): Record<string, string> {
    return {
      SANDBOX_WORKSPACE: workspace,
      REPO_URL: repoUrl,
      REPO_FULL_NAME: 'acme/app',
      DEPENDENCY_NAME: DEPENDENCY,
      TARGET_VERSION: '2.0.0',
      BRANCH_NAME: `synclab/${DEPENDENCY}-2.0.0`,
      GITHUB_API_URL: GITHUB_API,
      GITHUB_TOKEN: TOKEN,
      ...overrides,
    };
  }

  describe('with a locked repository', () => {
    let origin: { url: string; headSha: string };

    before(async () => {
      origin = await createOrigin('locked', { name: 'app', version: '1.0.0', dependencies: { [DEPENDENCY]: '1.0.0' } }, true);
    });

    it('clones, installs, upgrades and records the release notes', async () => {
      setJobEnv(jobEnv(origin.url));

      const result = await prepare();
      const repoDir = path.join(workspace, 'repo');

      assert.equal(result.phase, 'prepare');
      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.deepEqual(
        result.steps.map((step) => [step.step, step.exitCode]),
        [
          ['CLONE', 0],
          ['INSTALL', 0],
          ['UPGRADE', 0],
          ['CHANGELOG', undefined],
        ],
      );
      assert.deepEqual(result.data, { headSha: origin.headSha });

      const packageJson = await readJson(path.join(repoDir, 'package.json'));
      assert.deepEqual(packageJson.dependencies, { [DEPENDENCY]: '2.0.0' }, 'an exact pin stays exact');
      const lockfile = await readJson(path.join(repoDir, 'package-lock.json'));
      assert.equal(lockfile.packages[`node_modules/${DEPENDENCY}`].version, '2.0.0');
      const installed = await readJson(path.join(repoDir, 'node_modules', DEPENDENCY, 'package.json'));
      assert.equal(installed.version, '2.0.0');

      assert.equal(await readBreakingChanges(path.join(workspace, 'state')), releaseBody);
      assert.match(result.steps[3].output, /Found release notes for synclab-fixture-dep 2\.0\.0/);
    });

    it('asks GitHub for release notes with the job token and API URL', async () => {
      setJobEnv(jobEnv(origin.url));

      await prepare();

      const releaseCall = calls.find((call) => call.url.includes('/releases/tags/'));
      assert.ok(releaseCall);
      assert.ok(releaseCall.url.startsWith(`${GITHUB_API}/repos/acme/fixture-dep/`));
      assert.equal(releaseCall.headers.get('authorization'), `token ${TOKEN}`);
    });

    it('configures git credentials for the repository host', async () => {
      setJobEnv(jobEnv(origin.url));

      await prepare();

      assert.match(await fs.readFile(path.join(home, '.git-credentials'), 'utf8'), new RegExp(`x-access-token:${TOKEN}@`));
    });

    it('continues with a placeholder when no release notes exist', async () => {
      releaseBody = undefined;
      setJobEnv(jobEnv(origin.url));

      const result = await prepare();

      assert.equal(result.ok, true);
      assert.equal(
        await readBreakingChanges(path.join(workspace, 'state')),
        'No release notes were found for synclab-fixture-dep 2.0.0.',
      );
      assert.match(result.steps[3].output, /No release notes found for synclab-fixture-dep 2\.0\.0; continuing without them\./);
    });

    it('replaces a checkout left behind by an earlier attempt', async () => {
      const repoDir = path.join(workspace, 'repo');
      await fs.mkdir(repoDir, { recursive: true });
      await fs.writeFile(path.join(repoDir, 'stale.js'), 'leftover');
      setJobEnv(jobEnv(origin.url));

      const result = await prepare();

      assert.equal(result.ok, true);
      await assert.rejects(fs.access(path.join(repoDir, 'stale.js')));
    });

    it('stops when the target version cannot be installed', async () => {
      setJobEnv(jobEnv(origin.url, { TARGET_VERSION: '9.9.9' }));

      const result = await prepare();

      assert.equal(result.ok, false);
      assert.equal(result.error, `could not install ${DEPENDENCY}@9.9.9`);
      assert.deepEqual(result.steps.map((step) => step.step), ['CLONE', 'INSTALL', 'UPGRADE']);
      assert.notEqual(result.steps[2].exitCode, 0);
      assert.equal(await readBreakingChanges(path.join(workspace, 'state')), undefined);
    });

    it('refuses to upgrade a package that is not a direct dependency', async () => {
      setJobEnv(jobEnv(origin.url, { DEPENDENCY_NAME: 'lodash' }));

      const result = await prepare();

      assert.equal(result.ok, false);
      assert.equal(result.error, 'lodash is not a direct dependency in package.json, so it cannot be upgraded');
      assert.deepEqual(result.steps.map((step) => step.step), ['CLONE', 'INSTALL', 'UPGRADE']);
      assert.deepEqual((await readJson(path.join(workspace, 'repo', 'package.json'))).dependencies, {
        [DEPENDENCY]: '1.0.0',
      });
    });
  });

  it('installs with npm install when the repository has no lockfile', async () => {
    const origin = await createOrigin('unlocked', { name: 'app', version: '1.0.0', dependencies: { [DEPENDENCY]: '^1.0.0' } }, false);
    setJobEnv(jobEnv(origin.url));

    const result = await prepare();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepEqual((await readJson(path.join(workspace, 'repo', 'package.json'))).dependencies, {
      [DEPENDENCY]: '^2.0.0',
    });
  });

  it('stops when dependencies cannot be installed', async () => {
    const origin = await createOrigin(
      'broken',
      { name: 'app', version: '1.0.0', dependencies: { [DEPENDENCY]: '1.0.0', 'synclab-missing-package': '1.0.0' } },
      false,
    );
    setJobEnv(jobEnv(origin.url));

    const result = await prepare();

    assert.equal(result.ok, false);
    assert.equal(result.error, 'dependency install failed');
    assert.deepEqual(result.steps.map((step) => step.step), ['CLONE', 'INSTALL']);
    assert.notEqual(result.steps[1].exitCode, 0);
  });

  it('stops when the clone fails and redacts the token from its output', async () => {
    setJobEnv(jobEnv(pathToFileURL(path.join(root, TOKEN, 'missing.git')).href));

    const result = await prepare();

    assert.equal(result.ok, false);
    assert.equal(result.error, 'git clone failed');
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].step, 'CLONE');
    assert.notEqual(result.steps[0].exitCode, 0);
    assert.ok(!result.steps[0].output.includes(TOKEN), result.steps[0].output);
    assert.match(result.steps[0].output, /\*\*\*/);
  });

  it('requires a GitHub token before touching anything', async () => {
    const env = jobEnv('https://github.com/acme/app.git');
    delete env.GITHUB_TOKEN;
    setJobEnv(env);
    delete process.env.GITHUB_TOKEN;

    await assert.rejects(prepare(), { message: 'Missing required environment variable GITHUB_TOKEN' });
    await assert.rejects(fs.access(path.join(workspace, 'repo')));
  });
});
