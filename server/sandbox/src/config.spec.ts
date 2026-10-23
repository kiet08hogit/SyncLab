import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { loadConfig, requireToken, resolveLlmProvider } from './config.js';

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
  LLM_MODEL: 'gemini-3.1-pro-preview',
};

describe('config', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    for (const name of [
      ...Object.keys(REQUIRED),
      'SANDBOX_WORKSPACE',
      'GITHUB_API_URL',
      'GITHUB_TOKEN',
      'MIGRATION_KIND',
      'API_CHANGE',
      'TARGET_FILES',
    ]) {
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
      assert.deepEqual(config.migration, {
        kind: 'dependency',
        dependency: { name: REQUIRED.DEPENDENCY_NAME, version: REQUIRED.TARGET_VERSION },
      });
      assert.equal(config.branchName, REQUIRED.BRANCH_NAME);
      assert.equal(config.llm.model, REQUIRED.LLM_MODEL);
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

    it('refuses a migration kind it does not know', () => {
      Object.assign(process.env, REQUIRED, { MIGRATION_KIND: 'api-change' });

      assert.throws(() => loadConfig(), {
        message: 'MIGRATION_KIND must be dependency or api_change, got "api-change".',
      });
    });
  });

  describe('loadConfig for an API change', () => {
    const CHANGE = {
      provider: 'anthropic',
      kind: 'model_retired',
      operation: 'POST /v1/messages',
      field: 'claude-3-opus-20240229',
      replacement: 'claude-opus-4-1',
      effectiveAt: '2026-01-05',
      evidence: 'Claude 3 Opus is retired on January 5, 2026.',
      sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/model-deprecations',
    };

    function apiChangeEnv(overrides: Record<string, string> = {}): void {
      const env: Record<string, string> = {
        ...REQUIRED,
        MIGRATION_KIND: 'api_change',
        API_CHANGE: JSON.stringify(CHANGE),
        TARGET_FILES: JSON.stringify(['src/chat.ts', 'lib/summary.js']),
        BRANCH_NAME: 'synclab/api-anthropic-1b2c',
      };
      delete env.DEPENDENCY_NAME;
      delete env.TARGET_VERSION;
      Object.assign(process.env, env, overrides);
    }

    it('reads the brief and the impacted files, keeping the SDK the repository has', () => {
      apiChangeEnv();

      assert.deepEqual(loadConfig().migration, {
        kind: 'api_change',
        change: CHANGE,
        files: ['src/chat.ts', 'lib/summary.js'],
      });
    });

    it('carries the SDK upgrade when the change needs one', () => {
      apiChangeEnv({ DEPENDENCY_NAME: '@anthropic-ai/sdk', TARGET_VERSION: '0.60.0' });

      const { migration } = loadConfig();

      assert.equal(migration.kind, 'api_change');
      assert.deepEqual(migration.dependency, { name: '@anthropic-ai/sdk', version: '0.60.0' });
    });

    it('wants both halves of the SDK upgrade', () => {
      apiChangeEnv({ DEPENDENCY_NAME: '@anthropic-ai/sdk' });
      assert.throws(() => loadConfig(), { message: 'Missing required environment variable TARGET_VERSION' });

      delete process.env.DEPENDENCY_NAME;
      process.env.TARGET_VERSION = '0.60.0';
      assert.throws(() => loadConfig(), { message: 'Missing required environment variable DEPENDENCY_NAME' });
    });

    it('accepts the optional fields as null, the way the database stores them', () => {
      apiChangeEnv({
        API_CHANGE: JSON.stringify({ ...CHANGE, operation: null, replacement: null, effectiveAt: null }),
      });

      const { migration } = loadConfig();

      assert.equal(migration.kind, 'api_change');
      assert.equal(migration.change.operation, null);
      assert.equal(migration.change.effectiveAt, null);
    });

    it('requires the brief and the file list', () => {
      for (const name of ['API_CHANGE', 'TARGET_FILES']) {
        apiChangeEnv();
        delete process.env[name];

        assert.throws(() => loadConfig(), { message: `Missing required environment variable ${name}` });
      }
    });

    it('names the variable that is not JSON', () => {
      apiChangeEnv({ TARGET_FILES: 'src/chat.ts' });

      assert.throws(() => loadConfig(), /^Error: TARGET_FILES must be JSON: /);
    });

    it('refuses behavior_changed, which is reported but never migrated', () => {
      apiChangeEnv({ API_CHANGE: JSON.stringify({ ...CHANGE, kind: 'behavior_changed' }) });

      assert.throws(() => loadConfig(), /API_CHANGE is invalid: .*kind/s);
    });

    it('refuses a brief without its evidence or source', () => {
      for (const patch of [{ evidence: '' }, { sourceUrl: 'not a url' }, { effectiveAt: 'soon' }]) {
        apiChangeEnv({ API_CHANGE: JSON.stringify({ ...CHANGE, ...patch }) });

        assert.throws(() => loadConfig(), /API_CHANGE is invalid/, JSON.stringify(patch));
      }
    });

    it('refuses an empty file list and any path that could leave the repository', () => {
      for (const files of [[], ['/etc/passwd'], ['../outside.js'], ['..'], ['src/../../x.js'], ['./src/a.js'], ['']]) {
        apiChangeEnv({ TARGET_FILES: JSON.stringify(files) });

        assert.throws(() => loadConfig(), /TARGET_FILES is invalid/, JSON.stringify(files));
      }
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

describe('resolveLlmProvider', () => {
  it('defaults to gemini when the provider is not set', () => {
    assert.equal(resolveLlmProvider(undefined), 'gemini');
    assert.equal(resolveLlmProvider(''), 'gemini');
  });

  it('accepts each supported provider', () => {
    assert.equal(resolveLlmProvider('gemini'), 'gemini');
    assert.equal(resolveLlmProvider('anthropic'), 'anthropic');
  });

  it('refuses a provider it does not know rather than falling back to gemini', () => {
    assert.throws(() => resolveLlmProvider('Gemini'), {
      message: 'LLM_PROVIDER must be one of gemini, anthropic, got "Gemini".',
    });
    assert.throws(() => resolveLlmProvider('gemeni'), /must be one of gemini, anthropic/);
  });

  it('refuses ollama, which is no longer supported', () => {
    assert.throws(() => resolveLlmProvider('ollama'), /must be one of gemini, anthropic, got "ollama"/);
  });
});
