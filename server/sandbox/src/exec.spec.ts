import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { redact, run, runOrThrow } from './exec.js';
import { packageManagerEnv } from './package-manager.js';

const node = process.execPath;

describe('run', () => {
  it('captures stdout and stderr into one buffer along with the exit code', async () => {
    const result = await run(node, [
      '-e',
      'process.stdout.write("to-stdout\\n"); process.stderr.write("to-stderr\\n"); process.exitCode = 3;',
    ]);

    assert.equal(result.code, 3);
    assert.match(result.output, /to-stdout/);
    assert.match(result.output, /to-stderr/);
  });

  it('runs in the given working directory', async () => {
    const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-exec-')));
    try {
      const result = await run(node, ['-e', 'process.stdout.write(process.cwd())'], { cwd: dir });

      assert.equal(result.output, dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('layers extra environment variables over the parent environment', async () => {
    const result = await run(
      node,
      ['-e', 'process.stdout.write(`${process.env.SYNCLAB_EXTRA}:${typeof process.env.PATH}`)'],
      { env: { SYNCLAB_EXTRA: 'extra' } },
    );

    assert.equal(result.output, 'extra:string');
  });

  it('omits variables the override sets to undefined, including job and credential names', async () => {
    const saved: NodeJS.ProcessEnv = { ...process.env };
    const hidden = [
      'SANDBOX_WORKSPACE', 'REPO_URL', 'REPO_FULL_NAME', 'DEPENDENCY_NAME',
      'TARGET_VERSION', 'MIGRATION_KIND', 'API_CHANGE', 'TARGET_FILES', 'BRANCH_NAME',
      'TEST_BASELINE', 'BASE_SHA', 'GITHUB_TOKEN', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY',
      'LLM_MODEL', 'LLM_PROVIDER', 'REFACTOR_ATTEMPT', 'VALIDATE_TYPECHECK',
    ];
    const workspace = path.join(os.tmpdir(), 'job-workspace');
    try {
      for (const name of hidden) {
        process.env[name] = `secret-${name}`;
      }
      process.env.SYNCLAB_KEEP = 'keep-me';
      const result = await run(
        node,
        ['-e', `
          const hidden = ${JSON.stringify(hidden)};
          const leaked = [
            ...hidden.filter((name) => Object.hasOwn(process.env, name)),
            ...Object.keys(process.env).filter((name) => /^(LLM_|REFACTOR_|VALIDATE_)/.test(name)),
          ];
          process.stdout.write(JSON.stringify({
            leaked,
            keep: process.env.SYNCLAB_KEEP ?? null,
            corepack: process.env.COREPACK_HOME ?? null,
            yarn: process.env.YARN_GLOBAL_FOLDER ?? null,
            latest: process.env.COREPACK_DEFAULT_TO_LATEST ?? null,
            prompt: process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT ?? null,
            telemetry: process.env.YARN_ENABLE_TELEMETRY ?? null,
            path: typeof process.env.PATH,
          }));
        `],
        { env: packageManagerEnv(workspace) },
      );

      assert.equal(result.code, 0, result.output);
      const seen = JSON.parse(result.output) as {
        leaked: string[];
        keep: string | null;
        corepack: string | null;
        yarn: string | null;
        latest: string | null;
        prompt: string | null;
        telemetry: string | null;
        path: string;
      };
      assert.deepEqual(seen.leaked, []);
      assert.equal(seen.keep, 'keep-me');
      assert.equal(seen.corepack, path.join(workspace, '.corepack'));
      assert.equal(seen.yarn, path.join(workspace, '.yarn-global'));
      assert.equal(seen.latest, '0');
      assert.equal(seen.prompt, '0');
      assert.equal(seen.telemetry, '0');
      assert.equal(seen.path, 'string');
    } finally {
      for (const name of Object.keys(process.env)) {
        if (!(name in saved)) {
          delete process.env[name];
        }
      }
      Object.assign(process.env, saved);
    }
  });

  it('reports -1 when the process is killed by a signal', async () => {
    const result = await run(node, ['-e', 'process.kill(process.pid, "SIGKILL")']);

    assert.equal(result.code, -1);
  });

  it('rejects when the command cannot be started', async () => {
    await assert.rejects(run('synclab-command-that-does-not-exist', []), { code: 'ENOENT' });
  });
});

describe('runOrThrow', () => {
  it('returns the result of a successful command', async () => {
    const result = await runOrThrow(node, ['-e', 'console.log("fine")']);

    assert.equal(result.code, 0);
    assert.equal(result.output, 'fine\n');
  });

  it('throws with the command, exit code and output when the command fails', async () => {
    await assert.rejects(runOrThrow(node, ['-e', 'console.error("broken"); process.exit(2)']), (error: Error) => {
      assert.match(error.message, /exited with code 2/);
      assert.ok(error.message.includes(node));
      assert.match(error.message, /broken/);
      return true;
    });
  });
});

describe('redact', () => {
  it('replaces every occurrence of every secret', () => {
    assert.equal(
      redact('token abc and abc again, key xyz', ['abc', 'xyz']),
      'token *** and *** again, key ***',
    );
  });

  it('ignores missing and empty secrets', () => {
    assert.equal(redact('nothing to hide', [undefined, '']), 'nothing to hide');
  });

  it('treats secrets as literal text rather than patterns', () => {
    assert.equal(redact('a.b and axb', ['a.b']), '*** and axb');
  });
});
