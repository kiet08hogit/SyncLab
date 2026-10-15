import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { loadConfig, requireToken } from './config.js';

function restoreEnv(saved: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(process.env)) {
    if (!(name in saved)) {
      delete process.env[name];
    }
  }
  Object.assign(process.env, saved);
}

const REQUIRED = {
  REPO_URL: 'https://github.com/acme/widgets.git',
  REPO_FULL_NAME: 'acme/widgets',
  DEPENDENCY_NAME: 'lodash',
  TARGET_VERSION: '4.17.21',
  BRANCH_NAME: 'synclab/lodash-4.17.21',
};

describe('config', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    for (const name of [...Object.keys(REQUIRED), 'SANDBOX_WORKSPACE', 'GITHUB_API_URL', 'GITHUB_TOKEN']) {
      delete process.env[name];
    }
  });

  afterEach(() => {
    restoreEnv(savedEnv);
  });

  describe('loadConfig', () => {
    it('reads the job from the environment', () => {
      Object.assign(process.env, REQUIRED);

      const config = loadConfig();

      assert.equal(config.repoUrl, REQUIRED.REPO_URL);
      assert.equal(config.repoFullName, REQUIRED.REPO_FULL_NAME);
      assert.equal(config.dependencyName, REQUIRED.DEPENDENCY_NAME);
      assert.equal(config.targetVersion, REQUIRED.TARGET_VERSION);
      assert.equal(config.branchName, REQUIRED.BRANCH_NAME);
    });

    it('fails on each missing or empty required variable', () => {
      for (const name of Object.keys(REQUIRED)) {
        for (const value of [undefined, '']) {
          Object.assign(process.env, REQUIRED);
          if (value === undefined) {
            delete process.env[name];
          } else {
            process.env[name] = value;
          }

          assert.throws(() => loadConfig(), {
            message: `Missing required environment variable ${name}`,
          });
        }
      }
    });

    it('defaults the workspace to /workspace with repo and state inside it', () => {
      Object.assign(process.env, REQUIRED);

      const config = loadConfig();

      assert.equal(config.workspace, '/workspace');
      assert.equal(config.repoDir, path.join('/workspace', 'repo'));
      assert.equal(config.stateDir, path.join('/workspace', 'state'));
    });

    it('places repo and state inside a custom workspace', () => {
      Object.assign(process.env, REQUIRED, { SANDBOX_WORKSPACE: '/tmp/job-42' });

      const config = loadConfig();

      assert.equal(config.workspace, '/tmp/job-42');
      assert.equal(config.repoDir, path.join('/tmp/job-42', 'repo'));
      assert.equal(config.stateDir, path.join('/tmp/job-42', 'state'));
    });

    it('defaults to the public GitHub API and accepts an override', () => {
      Object.assign(process.env, REQUIRED);
      assert.equal(loadConfig().githubApiUrl, 'https://api.github.com');

      process.env.GITHUB_API_URL = 'https://github.example.com/api/v3';
      assert.equal(loadConfig().githubApiUrl, 'https://github.example.com/api/v3');
    });

    it('does not need a GitHub token', () => {
      Object.assign(process.env, REQUIRED);

      assert.doesNotThrow(() => loadConfig());
    });
  });

  describe('requireToken', () => {
    it('returns the GitHub token', () => {
      process.env.GITHUB_TOKEN = 'ghs_secret';

      assert.equal(requireToken(), 'ghs_secret');
    });

    it('fails when the token is missing or empty', () => {
      assert.throws(() => requireToken(), { message: 'Missing required environment variable GITHUB_TOKEN' });

      process.env.GITHUB_TOKEN = '';
      assert.throws(() => requireToken(), { message: 'Missing required environment variable GITHUB_TOKEN' });
    });
  });
});
