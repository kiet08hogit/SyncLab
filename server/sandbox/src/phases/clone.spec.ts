import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';
import { clone } from './clone.js';
import { git, isolatedEnv, restoreEnv, startRegistry } from './npm-fixture.spec.js';

const TOKEN = 'ghs_clonetoken';

/** Reads every file under a directory, so a test can prove a secret is not in any of them. */
async function contentsUnder(dir: string): Promise<string> {
  let all = '';
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      all += await fs.readFile(path.join(entry.parentPath, entry.name), 'latin1');
    }
  }
  return all;
}

describe('clone phase', () => {
  let root: string;
  let home: string;
  let registry: { server: Server; url: string };
  let savedEnv: NodeJS.ProcessEnv;
  let originUrl: string;
  let headSha: string;
  let workspace: string;

  before(async () => {
    savedEnv = { ...process.env };
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-clone-'));
    home = path.join(root, 'home');
    await fs.mkdir(home);
    // Only for the isolated git identity and config; nothing is installed.
    registry = await startRegistry(root);
    Object.assign(process.env, isolatedEnv(root, home, registry.url));

    // Two commits, so a shallow clone is distinguishable from a full one.
    const seed = path.join(root, 'seed');
    const bare = path.join(root, 'origin.git');
    await fs.mkdir(seed);
    await git(seed, 'init', '--initial-branch=main');
    await fs.writeFile(path.join(seed, 'a.ts'), 'export const a = 1;\n');
    await git(seed, 'add', '--all');
    await git(seed, 'commit', '-m', 'first');
    await fs.writeFile(path.join(seed, 'b.ts'), 'export const b = 2;\n');
    await git(seed, 'add', '--all');
    await git(seed, 'commit', '-m', 'second');
    await git(root, 'init', '--bare', '--initial-branch=main', bare);
    await git(seed, 'push', bare, 'main');
    originUrl = pathToFileURL(bare).href;
    headSha = await git(seed, 'rev-parse', 'HEAD');
  });

  after(async () => {
    restoreEnv(savedEnv);
    registry.server.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(root, 'workspace-'));
    process.env.SANDBOX_WORKSPACE = workspace;
    process.env.GITHUB_TOKEN = TOKEN;
    // A scan has no migration, so none of its settings are set.
    for (const name of ['REPO_FULL_NAME', 'DEPENDENCY_NAME', 'TARGET_VERSION', 'BRANCH_NAME', 'LLM_MODEL']) {
      delete process.env[name];
    }
  });

  it('makes a shallow clone of the default branch and reports its commit', async () => {
    process.env.REPO_URL = originUrl;

    const result = await clone();
    const repoDir = path.join(workspace, 'repo');

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.deepEqual(result.data, { headSha });
    assert.equal(await git(repoDir, 'rev-parse', 'HEAD'), headSha);
    assert.equal(await git(repoDir, 'rev-parse', '--is-shallow-repository'), 'true');
    assert.equal(await git(repoDir, 'rev-list', '--count', 'HEAD'), '1');
  });

  it('leaves the token off the volume the scan phase reads', async () => {
    process.env.REPO_URL = originUrl;

    const result = await clone();

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.doesNotMatch(await contentsUnder(workspace), new RegExp(TOKEN));
    assert.match(await fs.readFile(path.join(home, '.git-credentials'), 'utf8'), new RegExp(TOKEN));
  });

  it('fails without leaking the token when the clone fails', async () => {
    process.env.REPO_URL = pathToFileURL(path.join(root, 'missing.git')).href;

    const result = await clone();

    assert.equal(result.ok, false);
    assert.equal(result.error, 'git clone failed');
    assert.notEqual(result.steps[0].exitCode, 0);
    assert.doesNotMatch(result.steps[0].output, new RegExp(TOKEN));
  });
});
