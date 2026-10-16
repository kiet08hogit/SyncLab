import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { readBreakingChanges } from '../state.js';
import { prepare } from './prepare.js';
import { DEPENDENCY, createOrigin, exists, git, isolatedEnv, restoreEnv, startRegistry } from './npm-fixture.spec.js';

const TOKEN = 'ghs_preparetoken';
const GITHUB_API = 'https://github.test/api';

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

  before(async () => {
    savedEnv = { ...process.env };
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-prepare-'));
    home = path.join(root, 'home');
    await fs.mkdir(home);
    registry = await startRegistry(root);
    Object.assign(process.env, isolatedEnv(root, home, registry.url));
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
      LLM_MODEL: 'qwen2.5-coder:14b',
      GITHUB_API_URL: GITHUB_API,
      GITHUB_TOKEN: TOKEN,
      ...overrides,
    };
  }

  describe('with a locked repository', () => {
    let origin: { url: string; headSha: string };

    before(async () => {
      origin = await createOrigin(
        root,
        'locked',
        { name: 'app', version: '1.0.0', dependencies: { [DEPENDENCY]: '1.0.0' } },
        true,
      );
    });

    it('clones and records the release notes', async () => {
      setJobEnv(jobEnv(origin.url));

      const result = await prepare();

      assert.equal(result.phase, 'prepare');
      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.deepEqual(
        result.steps.map((step) => [step.step, step.exitCode]),
        [
          ['CLONE', 0],
          ['CHANGELOG', undefined],
        ],
      );
      assert.deepEqual(result.data, { headSha: origin.headSha });
      assert.equal(await git(path.join(workspace, 'repo'), 'rev-parse', 'HEAD'), origin.headSha);
      assert.equal(await readBreakingChanges(path.join(workspace, 'state')), releaseBody);
      assert.match(result.steps[1].output, /Found release notes for synclab-fixture-dep 2\.0\.0/);
    });

    it('neither installs nor upgrades, leaving package.json and the lockfile as cloned', async () => {
      setJobEnv(jobEnv(origin.url));

      const result = await prepare();
      const repoDir = path.join(workspace, 'repo');

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.ok(!result.steps.some((step) => step.step === 'INSTALL' || step.step === 'UPGRADE'));
      assert.equal(await exists(path.join(repoDir, 'node_modules')), false);
      assert.equal(await git(repoDir, 'status', '--porcelain', '--ignored'), '');
      const seed = path.join(root, 'locked-seed');
      for (const file of ['package.json', 'package-lock.json']) {
        assert.equal(
          await fs.readFile(path.join(repoDir, file), 'utf8'),
          await fs.readFile(path.join(seed, file), 'utf8'),
          file,
        );
      }
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
      assert.match(result.steps[1].output, /No release notes found for synclab-fixture-dep 2\.0\.0; continuing without them\./);
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

    it('does not validate the target version or the dependency, which is left to the upgrade phase', async () => {
      setJobEnv(jobEnv(origin.url, { DEPENDENCY_NAME: 'lodash', TARGET_VERSION: '9.9.9' }));

      const result = await prepare();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.deepEqual(result.steps.map((step) => step.step), ['CLONE', 'CHANGELOG']);
    });
  });

  it('stops when the clone fails and redacts the token from its output', async () => {
    const missing = path.join(root, TOKEN, 'missing.git');
    setJobEnv(jobEnv(pathToFileURL(missing).href));

    const result = await prepare();

    assert.equal(result.ok, false);
    assert.equal(result.error, 'git clone failed');
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].step, 'CLONE');
    assert.notEqual(result.steps[0].exitCode, 0);
    assert.ok(!result.steps[0].output.includes(TOKEN), result.steps[0].output);
    assert.match(result.steps[0].output, /\*\*\*/);
    assert.equal(await readBreakingChanges(path.join(workspace, 'state')), undefined);
  });

  it('requires a GitHub token before touching anything', async () => {
    const env = jobEnv('https://github.com/acme/app.git');
    delete env.GITHUB_TOKEN;
    setJobEnv(env);
    delete process.env.GITHUB_TOKEN;

    await assert.rejects(prepare(), { message: 'Missing required environment variable GITHUB_TOKEN' });
    await assert.rejects(fs.access(path.join(workspace, 'repo')));
    assert.equal(calls.length, 0);
  });
});
