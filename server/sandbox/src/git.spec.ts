import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { runOrThrow } from './exec.js';
import { configureGitCredentials, currentBranch, hasUncommittedChanges } from './git.js';

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

describe('git', () => {
  let savedEnv: NodeJS.ProcessEnv;
  let root: string;
  let home: string;

  beforeEach(async () => {
    savedEnv = { ...process.env };
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-git-'));
    home = path.join(root, 'home');
    await fs.mkdir(home);
    // Keep configureGitCredentials away from the real home directory and global git config.
    process.env.HOME = home;
    process.env.GIT_CONFIG_GLOBAL = path.join(home, '.gitconfig');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
  });

  afterEach(async () => {
    restoreEnv(savedEnv);
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('configureGitCredentials', () => {
    it('stores the token for the repository host in a private credentials file', async () => {
      await configureGitCredentials('ghs_secret', 'https://github.com/acme/widgets.git');

      const credentialsPath = path.join(home, '.git-credentials');
      assert.equal(await fs.readFile(credentialsPath, 'utf8'), 'https://x-access-token:ghs_secret@github.com\n');
      assert.equal((await fs.stat(credentialsPath)).mode & 0o777, 0o600);
    });

    it('keeps a non-default port as part of the host', async () => {
      await configureGitCredentials('ghs_secret', 'https://git.example.com:8443/acme/widgets.git');

      assert.equal(
        await fs.readFile(path.join(home, '.git-credentials'), 'utf8'),
        'https://x-access-token:ghs_secret@git.example.com:8443\n',
      );
    });

    it('replaces credentials left by an earlier run', async () => {
      await configureGitCredentials('ghs_old', 'https://github.com/acme/widgets.git');
      await configureGitCredentials('ghs_new', 'https://github.com/acme/widgets.git');

      assert.equal(
        await fs.readFile(path.join(home, '.git-credentials'), 'utf8'),
        'https://x-access-token:ghs_new@github.com\n',
      );
    });

    it('points git at the credential store and sets the bot identity globally', async () => {
      await configureGitCredentials('ghs_secret', 'https://github.com/acme/widgets.git');

      assert.equal(await git(home, 'config', '--global', 'credential.helper'), 'store');
      assert.equal(await git(home, 'config', '--global', 'user.name'), 'SyncLab Bot');
      assert.equal(await git(home, 'config', '--global', 'user.email'), 'bot@synclab.local');
    });

    it('rejects a repository URL that cannot be parsed', async () => {
      await assert.rejects(configureGitCredentials('ghs_secret', 'not a url'), TypeError);
    });
  });

  describe('repository inspection', () => {
    let repoDir: string;

    beforeEach(async () => {
      repoDir = path.join(root, 'repo');
      await fs.mkdir(repoDir);
      await git(repoDir, 'init', '--initial-branch=main');
      await git(repoDir, 'config', 'user.name', 'Test');
      await git(repoDir, 'config', 'user.email', 'test@example.com');
      await fs.writeFile(path.join(repoDir, 'index.js'), 'module.exports = 1;\n');
      await git(repoDir, 'add', '--all');
      await git(repoDir, 'commit', '-m', 'initial');
    });

    it('reports the checked out branch', async () => {
      assert.equal(await currentBranch(repoDir), 'main');

      await git(repoDir, 'checkout', '-b', 'feature/x');
      assert.equal(await currentBranch(repoDir), 'feature/x');
    });

    it('sees a clean working tree as unchanged', async () => {
      assert.equal(await hasUncommittedChanges(repoDir), false);
    });

    it('sees modified, staged and untracked files as changes', async () => {
      await fs.writeFile(path.join(repoDir, 'index.js'), 'module.exports = 2;\n');
      assert.equal(await hasUncommittedChanges(repoDir), true);

      await git(repoDir, 'add', '--all');
      assert.equal(await hasUncommittedChanges(repoDir), true);

      await git(repoDir, 'commit', '-m', 'second');
      await fs.writeFile(path.join(repoDir, 'new.js'), '');
      assert.equal(await hasUncommittedChanges(repoDir), true);
    });

    it('fails outside a git repository', async () => {
      const plainDir = path.join(root, 'plain');
      await fs.mkdir(plainDir);
      process.env.GIT_CEILING_DIRECTORIES = root;

      await assert.rejects(currentBranch(plainDir), /exited with code/);
      await assert.rejects(hasUncommittedChanges(plainDir), /exited with code/);
    });
  });
});
