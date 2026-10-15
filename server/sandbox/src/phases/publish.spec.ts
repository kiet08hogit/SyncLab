import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { run, runOrThrow } from '../exec.js';
import { publish } from './publish.js';

const TOKEN = 'ghs_publishtoken';
const GITHUB_API = 'https://github.test/api';
const BRANCH = 'synclab/lodash-4.17.21';

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

interface Call {
  method: string;
  url: string;
  headers: Headers;
  body?: Record<string, unknown>;
}

describe('publish phase', () => {
  const originalFetch = globalThis.fetch;
  let savedEnv: NodeJS.ProcessEnv;
  let root: string;
  let home: string;
  let origin: string;
  let repoDir: string;
  let calls: Call[];
  let createResponse: () => Response;
  let existingPullRequests: unknown[];

  before(async () => {
    savedEnv = { ...process.env };
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-publish-'));
    home = path.join(root, 'home');
    await fs.mkdir(home);
    // Keep git away from the developer's home directory and global config.
    Object.assign(process.env, {
      HOME: home,
      GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
    });
  });

  after(async () => {
    restoreEnv(savedEnv);
    await fs.rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const testDir = await fs.mkdtemp(path.join(root, 'case-'));
    const seed = path.join(testDir, 'seed');
    origin = path.join(testDir, 'origin.git');
    repoDir = path.join(testDir, 'workspace', 'repo');

    await fs.mkdir(seed);
    await fs.writeFile(path.join(seed, 'index.js'), "const _ = require('lodash');\n");
    await git(seed, 'init', '--initial-branch=main');
    await git(seed, 'add', '--all');
    await git(seed, '-c', 'user.name=Seed', '-c', 'user.email=seed@example.com', 'commit', '-m', 'initial');
    await git(testDir, 'init', '--bare', '--initial-branch=main', origin);
    await git(seed, 'push', origin, 'main');
    await git(testDir, 'clone', origin, repoDir);

    Object.assign(process.env, {
      SANDBOX_WORKSPACE: path.dirname(repoDir),
      REPO_URL: 'https://github.com/acme/widgets.git',
      REPO_FULL_NAME: 'acme/widgets',
      DEPENDENCY_NAME: 'lodash',
      TARGET_VERSION: '4.17.21',
      BRANCH_NAME: BRANCH,
      GITHUB_API_URL: GITHUB_API,
      GITHUB_TOKEN: TOKEN,
    });

    calls = [];
    existingPullRequests = [];
    createResponse = () => Response.json({ html_url: 'https://github.com/acme/widgets/pull/7' }, { status: 201 });

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        url,
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });

      if (method === 'POST' && url === `${GITHUB_API}/repos/acme/widgets/pulls`) {
        return createResponse();
      }
      if (method === 'GET' && url.startsWith(`${GITHUB_API}/repos/acme/widgets/pulls?`)) {
        return Response.json(existingPullRequests);
      }
      throw new Error(`unexpected request ${method} ${url}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function migrate(): Promise<void> {
    await fs.writeFile(path.join(repoDir, 'index.js'), "const _ = require('lodash');\n_.map([], String);\n");
    await fs.writeFile(path.join(repoDir, 'added.js'), 'module.exports = {};\n');
  }

  it('skips the pull request when the refactor changed nothing', async () => {
    const result = await publish();

    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { skipped: true });
    assert.equal(result.steps[0].output, 'The refactor produced no changes, so no pull request was opened.');
    assert.equal(await git(origin, 'branch', '--list', BRANCH), '');
    assert.equal(calls.length, 0);
  });

  it('commits every change as the bot and pushes the migration branch', async () => {
    await migrate();

    const result = await publish();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(await git(origin, 'log', '-1', '--format=%s', BRANCH), 'chore: migrate lodash to 4.17.21');
    assert.equal(await git(origin, 'log', '-1', '--format=%an <%ae>', BRANCH), 'SyncLab Bot <bot@synclab.local>');
    assert.equal(await git(origin, 'rev-parse', `${BRANCH}^`), await git(origin, 'rev-parse', 'main'));
    assert.equal(await git(origin, 'show', `${BRANCH}:added.js`), 'module.exports = {};');
    assert.match(await git(origin, 'show', `${BRANCH}:index.js`), /_\.map/);
    assert.equal(await git(repoDir, 'status', '--porcelain'), '');
  });

  it('opens a pull request from the migration branch onto the original branch', async () => {
    await migrate();

    const result = await publish();

    assert.deepEqual(result.data, { pullRequestUrl: 'https://github.com/acme/widgets/pull/7', branchName: BRANCH });
    assert.equal(
      result.steps[0].output,
      `Pushed ${BRANCH} onto main and opened https://github.com/acme/widgets/pull/7`,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.get('authorization'), `token ${TOKEN}`);
    assert.equal(calls[0].body?.title, 'Migrate lodash to 4.17.21');
    assert.equal(calls[0].body?.head, BRANCH);
    assert.equal(calls[0].body?.base, 'main');
    assert.match(String(calls[0].body?.body), /Automated migration of `lodash` to `4\.17\.21`/);
  });

  it('overwrites a branch left behind by an earlier attempt and reuses its open pull request', async () => {
    const other = path.join(root, `other-${path.basename(path.dirname(origin))}`);
    await git(root, 'clone', origin, other);
    await fs.writeFile(path.join(other, 'stale.js'), '');
    await git(other, 'add', '--all');
    await git(other, '-c', 'user.name=Old', '-c', 'user.email=old@example.com', 'commit', '-m', 'stale attempt');
    await git(other, 'push', 'origin', `HEAD:refs/heads/${BRANCH}`);

    createResponse = () =>
      Response.json(
        { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for acme:synclab/lodash-4.17.21.' }] },
        { status: 422 },
      );
    existingPullRequests = [{ html_url: 'https://github.com/acme/widgets/pull/3' }];
    await migrate();

    const result = await publish();

    assert.equal(result.ok, true);
    assert.equal(result.data?.pullRequestUrl, 'https://github.com/acme/widgets/pull/3');
    assert.equal(await git(origin, 'log', '-1', '--format=%s', BRANCH), 'chore: migrate lodash to 4.17.21');
    assert.equal(await git(origin, 'rev-parse', `${BRANCH}^`), await git(origin, 'rev-parse', 'main'));

    const list = new URL(calls[1].url);
    assert.equal(list.searchParams.get('head'), `acme:${BRANCH}`);
    assert.equal(list.searchParams.get('state'), 'open');
  });

  it('surfaces the GitHub error when no pull request can be created or found', async () => {
    createResponse = () => Response.json({ message: 'Resource not accessible by integration' }, { status: 403 });
    await migrate();

    await assert.rejects(publish(), { status: 403 });
    assert.deepEqual(
      calls.map((call) => call.method),
      ['POST', 'GET'],
    );
  });

  it('fails without calling GitHub when the push is rejected, redacting the token', async () => {
    await git(repoDir, 'remote', 'set-url', 'origin', path.join(root, TOKEN, 'missing.git'));
    await migrate();

    const result = await publish();

    assert.equal(result.ok, false);
    assert.equal(result.error, 'git push failed');
    assert.equal(result.steps[0].step, 'PR');
    assert.notEqual(result.steps[0].exitCode, 0);
    assert.ok(!result.steps[0].output.includes(TOKEN), result.steps[0].output);
    assert.match(result.steps[0].output, /\*\*\*/);
    assert.equal(calls.length, 0);
  });

  it('rejects a repository name that is not owner/repo', async () => {
    process.env.REPO_FULL_NAME = 'widgets';
    await migrate();

    await assert.rejects(publish(), {
      message: 'REPO_FULL_NAME must be in "owner/repo" form, received "widgets"',
    });
    assert.equal(calls.length, 0);
  });

  it('requires a GitHub token', async () => {
    delete process.env.GITHUB_TOKEN;
    await migrate();

    await assert.rejects(publish(), { message: 'Missing required environment variable GITHUB_TOKEN' });
    assert.notEqual((await run('git', ['status', '--porcelain'], { cwd: repoDir })).output.trim(), '');
  });
});
