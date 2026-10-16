import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

async function exists(filePath: string): Promise<boolean> {
  return fs
    .lstat(filePath)
    .then(() => true)
    .catch(() => false);
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
  let testDir: string;
  let tmp: string;
  let markers: string;
  let origin: string;
  let baseSha: string;
  let repoDir: string;
  let calls: Call[];
  let createResponse: () => Response;
  let existingPullRequests: unknown[];

  before(async () => {
    savedEnv = { ...process.env };
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-publish-spec-'));
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
    testDir = await fs.mkdtemp(path.join(root, 'case-'));
    const seed = path.join(testDir, 'seed');
    origin = path.join(testDir, 'origin.git');
    repoDir = path.join(testDir, 'workspace', 'repo');
    // publish clones into os.tmpdir(); a directory per case shows what it leaves behind.
    tmp = path.join(testDir, 'tmp');
    markers = path.join(testDir, 'markers');
    await fs.mkdir(tmp);
    await fs.mkdir(markers);
    await fs.rm(path.join(home, '.git-credentials'), { force: true });

    await fs.mkdir(seed);
    await fs.writeFile(path.join(seed, 'index.js'), "const _ = require('lodash');\n");
    await git(seed, 'init', '--initial-branch=main');
    await git(seed, 'add', '--all');
    await git(seed, '-c', 'user.name=Seed', '-c', 'user.email=seed@example.com', 'commit', '-m', 'initial');
    await git(testDir, 'init', '--bare', '--initial-branch=main', origin);
    await git(seed, 'push', origin, 'main');
    baseSha = await git(seed, 'rev-parse', 'HEAD');
    // What prepare leaves on the job volume, and later phases may tamper with.
    await git(testDir, 'clone', origin, repoDir);

    Object.assign(process.env, {
      TMPDIR: tmp,
      SANDBOX_WORKSPACE: path.dirname(repoDir),
      REPO_URL: pathToFileURL(origin).href,
      REPO_FULL_NAME: 'acme/widgets',
      DEPENDENCY_NAME: 'lodash',
      TARGET_VERSION: '4.17.21',
      BRANCH_NAME: BRANCH,
      LLM_MODEL: 'qwen2.5-coder:14b',
      GITHUB_API_URL: GITHUB_API,
      GITHUB_TOKEN: TOKEN,
      BASE_SHA: baseSha,
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

  async function publishClones(): Promise<string[]> {
    return (await fs.readdir(tmp)).filter((name) => name.startsWith('synclab-publish-'));
  }

  async function publishedFiles(): Promise<string[]> {
    return (await git(origin, 'ls-tree', '-r', '--name-only', BRANCH)).split('\n');
  }

  async function branchExists(): Promise<boolean> {
    return (await git(origin, 'branch', '--list', BRANCH)) !== '';
  }

  /** A script that leaves a marker file named after itself when anything runs it. */
  async function trap(name: string): Promise<string> {
    const scripts = path.join(testDir, 'scripts');
    await fs.mkdir(scripts, { recursive: true });
    const script = path.join(scripts, name);
    await fs.writeFile(script, `#!/bin/sh\necho ran > "${path.join(markers, name)}"\nexec cat\n`, { mode: 0o755 });
    return script;
  }

  /** Commits on origin's main as another contributor would, returning the new commit. */
  async function commitOnMain(change: (dir: string) => Promise<void>): Promise<string> {
    const other = path.join(testDir, `other-${Date.now()}`);
    await git(testDir, 'clone', origin, other);
    await change(other);
    await git(other, 'add', '--all');
    await git(other, '-c', 'user.name=Other', '-c', 'user.email=other@example.com', 'commit', '-m', 'upstream change');
    await git(other, 'push', 'origin', 'main');
    return git(other, 'rev-parse', 'HEAD');
  }

  it('skips the pull request when the refactor changed nothing', async () => {
    const result = await publish();

    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { skipped: true });
    assert.equal(result.steps[0].output, 'The refactor produced no changes, so no pull request was opened.');
    assert.equal(await branchExists(), false);
    assert.equal(calls.length, 0);
    assert.deepEqual(await publishClones(), []);
  });

  it('commits every change as the bot and pushes the migration branch onto BASE_SHA', async () => {
    await migrate();

    const result = await publish();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(await git(origin, 'log', '-1', '--format=%s', BRANCH), 'chore: migrate lodash to 4.17.21');
    assert.equal(await git(origin, 'log', '-1', '--format=%an <%ae>', BRANCH), 'SyncLab Bot <bot@synclab.local>');
    assert.equal(await git(origin, 'rev-parse', `${BRANCH}^`), baseSha);
    assert.equal(await git(origin, 'show', `${BRANCH}:added.js`), 'module.exports = {};');
    assert.match(await git(origin, 'show', `${BRANCH}:index.js`), /_\.map/);
  });

  it('never runs git in the untrusted checkout, which is left exactly as the earlier phases left it', async () => {
    await migrate();
    const headBefore = await git(repoDir, 'rev-parse', 'HEAD');
    const indexBefore = await fs.readFile(path.join(repoDir, '.git', 'index'));

    const result = await publish();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(await git(repoDir, 'rev-parse', 'HEAD'), headBefore);
    assert.deepEqual(await fs.readFile(path.join(repoDir, '.git', 'index')), indexBefore);
    assert.equal(await git(repoDir, 'status', '--porcelain'), 'M index.js\n?? added.js');
  });

  it('keeps executable bits', async () => {
    await fs.writeFile(path.join(repoDir, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
    await fs.writeFile(path.join(repoDir, 'data.txt'), 'x\n', { mode: 0o600 });

    await publish();

    const tree = await git(origin, 'ls-tree', BRANCH);
    assert.match(tree, /^100755 blob \w+\trun\.sh$/m);
    assert.match(tree, /^100644 blob \w+\tdata\.txt$/m);
  });

  it('follows git in ignoring group and other exec bits', async () => {
    await fs.writeFile(path.join(repoDir, 'shared.txt'), 'x\n');
    await fs.chmod(path.join(repoDir, 'shared.txt'), 0o655);

    await publish();

    assert.match(await git(origin, 'ls-tree', BRANCH), /^100644 blob \w+\tshared\.txt$/m);
  });

  it('commits a file the earlier phases deleted as a deletion', async () => {
    // e.g. Yarn berry zero-installs: upgrading removes the old zip from .yarn/cache.
    await fs.rm(path.join(repoDir, 'index.js'));
    await fs.writeFile(path.join(repoDir, 'added.js'), 'module.exports = {};\n');

    const result = await publish();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepEqual(await publishedFiles(), ['added.js']);
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
    const other = path.join(testDir, 'stale-clone');
    await git(testDir, 'clone', origin, other);
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
    assert.equal(await git(origin, 'rev-parse', `${BRANCH}^`), baseSha);
    assert.ok(!(await publishedFiles()).includes('stale.js'));

    const list = new URL(calls[1].url);
    assert.equal(list.searchParams.get('head'), `acme:${BRANCH}`);
    assert.equal(list.searchParams.get('state'), 'open');
  });

  it('surfaces the GitHub error when no pull request can be created or found, still removing its clone', async () => {
    createResponse = () => Response.json({ message: 'Resource not accessible by integration' }, { status: 403 });
    await migrate();

    await assert.rejects(publish(), { status: 403 });
    assert.deepEqual(
      calls.map((call) => call.method),
      ['POST', 'GET'],
    );
    assert.deepEqual(await publishClones(), []);
  });

  it('fails without calling GitHub when the push is rejected, redacting the token and removing its clone', async () => {
    // The token in the remote's path makes it show up in git's error output.
    const tokenOrigin = path.join(testDir, TOKEN, 'origin.git');
    await git(testDir, 'clone', '--bare', origin, tokenOrigin);
    // A branch named "synclab" makes refs/heads/synclab/... impossible to create.
    await git(tokenOrigin, 'branch', 'synclab', 'main');
    process.env.REPO_URL = pathToFileURL(tokenOrigin).href;
    await migrate();

    const result = await publish();

    assert.equal(result.ok, false);
    assert.equal(result.error, 'git push failed');
    assert.equal(result.steps[0].step, 'PR');
    assert.notEqual(result.steps[0].exitCode, 0);
    assert.ok(!result.steps[0].output.includes(TOKEN), result.steps[0].output);
    assert.match(result.steps[0].output, /\*\*\*/);
    assert.equal(calls.length, 0);
    assert.deepEqual(await publishClones(), []);
  });

  it('fails when the repository cannot be cloned, redacting the token and removing its clone', async () => {
    process.env.REPO_URL = pathToFileURL(path.join(testDir, TOKEN, 'missing.git')).href;
    await migrate();

    const result = await publish();

    assert.equal(result.ok, false);
    assert.equal(result.error, 'git clone failed');
    assert.equal(result.steps[0].step, 'PR');
    assert.notEqual(result.steps[0].exitCode, 0);
    assert.ok(!result.steps[0].output.includes(TOKEN), result.steps[0].output);
    assert.equal(calls.length, 0);
    assert.deepEqual(await publishClones(), []);
  });

  it('removes its clone after a successful publish', async () => {
    await migrate();

    const result = await publish();

    assert.equal(result.ok, true);
    assert.deepEqual(await publishClones(), []);
  });

  it('rejects a repository name that is not owner/repo before cloning, pushing or writing credentials', async () => {
    await migrate();
    // Validation comes first: these would otherwise fail too.
    delete process.env.GITHUB_TOKEN;
    delete process.env.BASE_SHA;

    for (const name of ['widgets', 'a/b/c', 'owner', 'owner/', '/repo', 'owner/..', 'owner/.', '../repo', 'ow ner/repo', 'owner/re po', 'owner/repo\n', 'acme.inc/repo', 'owner\\repo']) {
      process.env.REPO_FULL_NAME = name;

      await assert.rejects(publish(), {
        message: `REPO_FULL_NAME must be in "owner/repo" form, received "${name}"`,
      }, JSON.stringify(name));
    }
    assert.equal(calls.length, 0);
    assert.deepEqual(await fs.readdir(tmp), []);
    assert.equal(await exists(path.join(home, '.git-credentials')), false);
    assert.equal(await branchExists(), false);
  });

  it('accepts dots, underscores and hyphens in the repository name', async () => {
    process.env.REPO_FULL_NAME = 'acme-co/my_repo.js';

    const result = await publish();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  });

  it('requires BASE_SHA to be a full lowercase commit id before cloning', async () => {
    await migrate();

    for (const value of [undefined, '', 'HEAD', 'main', baseSha.slice(0, 7), `${baseSha}0`, baseSha.toUpperCase(), `--upload-pack=touch${baseSha.slice(23)}`, `${baseSha.slice(0, 39)}g`]) {
      if (value === undefined) {
        delete process.env.BASE_SHA;
      } else {
        process.env.BASE_SHA = value;
      }

      await assert.rejects(publish(), {
        message: `BASE_SHA must be the full commit prepare cloned, received "${value ?? ''}"`,
      }, JSON.stringify(value));
    }
    assert.equal(calls.length, 0);
    assert.deepEqual(await fs.readdir(tmp), []);
    assert.equal(await exists(path.join(home, '.git-credentials')), false);
  });

  it('fails without pushing when BASE_SHA is not a commit in the repository', async () => {
    process.env.BASE_SHA = '0123456789abcdef0123456789abcdef01234567';
    await migrate();

    await assert.rejects(publish(), /checkout -B/);
    assert.equal(await branchExists(), false);
    assert.equal(calls.length, 0);
    assert.deepEqual(await publishClones(), []);
  });

  it('requires a GitHub token', async () => {
    delete process.env.GITHUB_TOKEN;
    await migrate();

    await assert.rejects(publish(), { message: 'Missing required environment variable GITHUB_TOKEN' });
    assert.notEqual((await run('git', ['status', '--porcelain'], { cwd: repoDir })).output.trim(), '');
    assert.deepEqual(await fs.readdir(tmp), []);
  });

  it("builds on BASE_SHA even after the remote's default branch has moved on", async () => {
    const moved = await commitOnMain((dir) => fs.writeFile(path.join(dir, 'upstream.js'), 'later\n'));
    await migrate();

    const result = await publish();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(await git(origin, 'rev-parse', `${BRANCH}^`), baseSha);
    assert.notEqual(await git(origin, 'rev-parse', `${BRANCH}^`), moved);
    assert.deepEqual(await publishedFiles(), ['added.js', 'index.js']);
    assert.equal(calls[0].body?.base, 'main');
  });

  it('never commits node_modules or any .git contents', async () => {
    await migrate();
    for (const file of [
      'node_modules/lodash/index.js',
      'packages/a/node_modules/dep/index.js',
      'packages/a/src.js',
      'vendor/lib/.git/config',
      'vendor/lib/.git/hooks/pre-commit',
      'vendor/lib/index.js',
    ]) {
      await fs.mkdir(path.join(repoDir, path.dirname(file)), { recursive: true });
      await fs.writeFile(path.join(repoDir, file), 'x\n');
    }

    const result = await publish();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepEqual(await publishedFiles(), ['added.js', 'index.js', 'packages/a/src.js', 'vendor/lib/index.js']);
  });

  describe('against a tampered checkout', () => {
    const HOOKS = [
      'pre-commit',
      'prepare-commit-msg',
      'commit-msg',
      'post-commit',
      'post-checkout',
      'pre-push',
      'reference-transaction',
      'post-index-change',
    ];

    async function plantHooks(hooksDir: string, prefix: string): Promise<void> {
      await fs.mkdir(hooksDir, { recursive: true });
      for (const hook of HOOKS) {
        await fs.writeFile(
          path.join(hooksDir, hook),
          `#!/bin/sh\necho ran > "${path.join(markers, `${prefix}${hook}`)}"\ncat > /dev/null\n`,
          { mode: 0o755 },
        );
      }
    }

    async function firedMarkers(): Promise<string[]> {
      return (await fs.readdir(markers)).sort();
    }

    /** Proves the plant is live: git run in a copy of the checkout does trigger it. */
    async function control(): Promise<string> {
      const copy = path.join(testDir, 'control');
      await runOrThrow('cp', ['-Rp', repoDir, copy]);
      return copy;
    }

    async function clearMarkers(): Promise<void> {
      await fs.rm(markers, { recursive: true, force: true });
      await fs.mkdir(markers);
    }

    it('never runs a hook planted in its .git/hooks', async () => {
      await plantHooks(path.join(repoDir, '.git', 'hooks'), '');
      await migrate();

      const copy = await control();
      await git(copy, '-c', 'user.name=x', '-c', 'user.email=x@example.com', 'commit', '--allow-empty', '-m', 'control');
      assert.ok((await firedMarkers()).includes('pre-commit'), 'the planted hooks are live');
      await clearMarkers();

      const result = await publish();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.deepEqual(await firedMarkers(), []);
      assert.equal(await git(origin, 'rev-parse', `${BRANCH}^`), baseSha);
    });

    it('never runs commands from its .git/config', async () => {
      const hooksPath = path.join(testDir, 'hooks-path');
      await plantHooks(hooksPath, 'hooks-path-');
      const settings: [string, string][] = [
        ['core.fsmonitor', await trap('fsmonitor')],
        ['core.hooksPath', hooksPath],
        ['credential.helper', `!${await trap('credential-helper')}`],
        ['filter.evil.clean', await trap('filter-clean')],
        ['filter.evil.smudge', await trap('filter-smudge')],
        ['diff.evil.textconv', await trap('textconv')],
        ['core.sshCommand', await trap('ssh-command')],
        ['core.pager', await trap('pager')],
        ['core.editor', await trap('editor')],
        ['gpg.program', await trap('gpg-program')],
        ['commit.gpgSign', 'true'],
      ];
      for (const [key, value] of settings) {
        await git(repoDir, 'config', key, value);
      }
      await fs.writeFile(path.join(repoDir, '.gitattributes'), '*.js filter=evil diff=evil\n');
      await migrate();

      const copy = await control();
      await git(copy, 'status');
      await git(copy, 'add', 'index.js');
      spawnSync('git', ['credential', 'fill'], {
        cwd: copy,
        input: 'protocol=https\nhost=example.com\n\n',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      const fired = await firedMarkers();
      for (const name of ['fsmonitor', 'filter-clean', 'credential-helper']) {
        assert.ok(fired.includes(name), `the planted ${name} is live: ${fired.join(', ')}`);
      }
      await clearMarkers();

      const result = await publish();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.deepEqual(await firedMarkers(), []);
      // The clean filter would have rewritten nothing, but it must not have run at all.
      assert.equal(
        await git(origin, 'show', `${BRANCH}:index.js`),
        (await fs.readFile(path.join(repoDir, 'index.js'), 'utf8')).trim(),
      );
      assert.equal(await git(origin, 'log', '-1', '--format=%G?', BRANCH), 'N');
    });

    it('commits a symlink as a symlink without following it', async () => {
      const outside = path.join(testDir, 'outside');
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, 'secret.txt'), 'secret\n');
      await fs.symlink('index.js', path.join(repoDir, 'alias.js'));
      await fs.symlink(outside, path.join(repoDir, 'outside-dir'));
      await fs.symlink(path.join(outside, 'secret.txt'), path.join(repoDir, 'outside-file'));

      const result = await publish();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      const tree = await git(origin, 'ls-tree', BRANCH);
      assert.match(tree, /^120000 blob \w+\talias\.js$/m);
      assert.match(tree, /^120000 blob \w+\toutside-dir$/m);
      assert.match(tree, /^120000 blob \w+\toutside-file$/m);
      assert.equal(await git(origin, 'cat-file', '-p', `${BRANCH}:alias.js`), 'index.js');
      assert.equal(await git(origin, 'cat-file', '-p', `${BRANCH}:outside-dir`), outside);
      assert.equal(await git(origin, 'cat-file', '-p', `${BRANCH}:outside-file`), path.join(outside, 'secret.txt'));
      assert.deepEqual(await publishedFiles(), ['alias.js', 'index.js', 'outside-dir', 'outside-file']);
    });

    it('does not write through a symlink the base commit tracks, outside the clone', async () => {
      const outside = path.join(testDir, 'outside');
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, 'secret.json'), '{"keep":true}\n');
      // The base commit links lib/ and config.json out of the repository...
      baseSha = await commitOnMain(async (dir) => {
        await fs.symlink(outside, path.join(dir, 'lib'));
        await fs.symlink(path.join(outside, 'secret.json'), path.join(dir, 'config.json'));
      });
      process.env.BASE_SHA = baseSha;
      await git(repoDir, 'pull', '--ff-only');
      // ...and the work tree replaces them with real content, which a naive copy writes through the links.
      await fs.rm(path.join(repoDir, 'lib'));
      await fs.rm(path.join(repoDir, 'config.json'));
      await fs.mkdir(path.join(repoDir, 'lib'));
      await fs.writeFile(path.join(repoDir, 'lib', 'evil.js'), 'pwned\n');
      await fs.writeFile(path.join(repoDir, 'config.json'), '{"pwned":true}\n');

      const result = await publish();

      assert.equal(result.ok, true, JSON.stringify(result, null, 2));
      assert.deepEqual(await fs.readdir(outside), ['secret.json']);
      assert.equal(await fs.readFile(path.join(outside, 'secret.json'), 'utf8'), '{"keep":true}\n');
      const tree = await git(origin, 'ls-tree', BRANCH);
      assert.match(tree, /^040000 tree \w+\tlib$/m);
      assert.match(tree, /^100644 blob \w+\tconfig\.json$/m);
      assert.equal(await git(origin, 'show', `${BRANCH}:lib/evil.js`), 'pwned');
    });
  });
});
