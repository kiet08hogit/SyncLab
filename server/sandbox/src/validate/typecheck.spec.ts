import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { check } from './checks/typecheck.js';

const require = createRequire(import.meta.url);
const TYPESCRIPT_DIR = path.dirname(require.resolve('typescript/package.json'));

const SDK = {
  package: '@anthropic-ai/sdk',
  version: '0.60.0',
};

function context(typecheck?: { package: string; version: string }): string {
  return JSON.stringify(typecheck ? { typecheck } : {});
}

describe('typecheck', () => {
  let workspace: string;
  let repoDir: string;
  let previous: NodeJS.ProcessEnv;

  beforeEach(async () => {
    previous = { ...process.env };
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-typecheck-'));
    repoDir = path.join(workspace, 'repo');
    await fs.mkdir(repoDir);
    process.env.SANDBOX_WORKSPACE = workspace;
    process.env.VALIDATE_CONTEXT = context(SDK);
  });

  afterEach(async () => {
    process.env = previous;
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function write(relativePath: string, contents: string): Promise<void> {
    const target = path.join(repoDir, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }

  async function installSdk(version: string, declaration: string): Promise<void> {
    await write(
      'node_modules/@anthropic-ai/sdk/package.json',
      JSON.stringify({ name: '@anthropic-ai/sdk', version, types: 'index.d.ts' }),
    );
    await write('node_modules/@anthropic-ai/sdk/index.d.ts', declaration);
    await fs.mkdir(path.join(repoDir, 'node_modules'), { recursive: true });
    await fs.symlink(TYPESCRIPT_DIR, path.join(repoDir, 'node_modules', 'typescript'), 'dir');
  }

  async function typescriptProject(source: string): Promise<void> {
    await write(
      'package.json',
      JSON.stringify({ name: 'fixture', type: 'module', dependencies: { '@anthropic-ai/sdk': SDK.version } }),
    );
    await write(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'ES2022',
          skipLibCheck: true,
          incremental: false,
        },
        include: ['src'],
      }),
    );
    await write('src/chat.ts', source);
    await installSdk(
      '0.60.0',
      'export interface MessageCreateParams { model: string }\nexport function create(body: MessageCreateParams): void;\n',
    );
  }

  it('passes when the change does not name an SDK', async () => {
    process.env.VALIDATE_CONTEXT = context();
    await typescriptProject("import { create } from '@anthropic-ai/sdk';\ncreate({ model: 'x', max_tokens: 1 });\n");

    assert.equal(await check.run(), undefined);
  });

  it('checks a nested API package when the root has no manifest', async () => {
    await typescriptProject("import { create } from '@anthropic-ai/sdk';\ncreate({ model: 'x', max_tokens: 1 });\n");
    const staged = path.join(workspace, 'package');
    await fs.rename(repoDir, staged);
    await fs.mkdir(path.join(repoDir, 'server'), { recursive: true });
    await fs.rename(staged, path.join(repoDir, 'server', 'sdk'));
    Object.assign(process.env, {
      MIGRATION_KIND: 'api_change',
      API_CHANGE: JSON.stringify({ provider: 'anthropic', kind: 'param_removed', field: 'max_tokens', evidence: 'Removed max_tokens', sourceUrl: 'https://example.com/replay' }),
      TARGET_FILES: JSON.stringify(['server/sdk/src/chat.ts']),
      REPO_URL: 'https://github.com/acme/api.git', REPO_FULL_NAME: 'acme/api', BRANCH_NAME: 'replay', LLM_MODEL: 'test',
    });
    const reason = await check.run();
    assert.match(reason ?? '', /^server\/sdk:/);
    assert.match(reason ?? '', /max_tokens/);
  });

  it('passes a repository that is not TypeScript', async () => {
    await write('src/chat.js', 'module.exports = 1;\n');

    assert.equal(await check.run(), undefined);
  });

  it('reports a type error against the SDK the change requires', async () => {
    await typescriptProject("import { create } from '@anthropic-ai/sdk';\ncreate({ model: 'x', max_tokens: 1 });\n");

    const reason = await check.run();

    assert.match(reason ?? '', /^@anthropic-ai\/sdk@0\.60\.0\n/);
    assert.match(reason ?? '', /max_tokens/);
  });

  it('passes when the migrated file typechecks against that SDK', async () => {
    await typescriptProject("import { create } from '@anthropic-ai/sdk';\ncreate({ model: 'x' });\n");

    assert.equal(await check.run(), undefined);
  });

  it('typechecks the installed SDK when it is newer than the required release', async () => {
    await typescriptProject("import { create } from '@anthropic-ai/sdk';\ncreate({ model: 'x' });\n");
    await write(
      'node_modules/@anthropic-ai/sdk/package.json',
      JSON.stringify({ name: '@anthropic-ai/sdk', version: '1.3.0', types: 'index.d.ts' }),
    );
    process.env.VALIDATE_CONTEXT = context({ package: '@anthropic-ai/sdk', version: '0.123.0' });

    assert.equal(await check.run(), undefined);
  });

  it('reports a type error against the installed SDK when that release is newer', async () => {
    await typescriptProject("import { create } from '@anthropic-ai/sdk';\ncreate({ model: 'x', max_tokens: 1 });\n");
    await write(
      'node_modules/@anthropic-ai/sdk/package.json',
      JSON.stringify({ name: '@anthropic-ai/sdk', version: '1.3.0', types: 'index.d.ts' }),
    );
    process.env.VALIDATE_CONTEXT = context({ package: '@anthropic-ai/sdk', version: '0.123.0' });

    const reason = await check.run();

    assert.match(reason ?? '', /^@anthropic-ai\/sdk@1\.3\.0\n/);
    assert.match(reason ?? '', /max_tokens/);
  });

  it('accepts a later numeric prerelease of the same release', async () => {
    await typescriptProject("import { create } from '@anthropic-ai/sdk';\ncreate({ model: 'x' });\n");
    await write(
      'node_modules/@anthropic-ai/sdk/package.json',
      JSON.stringify({ name: '@anthropic-ai/sdk', version: '6.4.0-beta.10', types: 'index.d.ts' }),
    );
    process.env.VALIDATE_CONTEXT = context({ package: '@anthropic-ai/sdk', version: '6.4.0-beta.2' });

    assert.equal(await check.run(), undefined);
  });

  it('accepts a release that is newer than the required prerelease', async () => {
    await typescriptProject("import { create } from '@anthropic-ai/sdk';\ncreate({ model: 'x' });\n");
    await write(
      'node_modules/@anthropic-ai/sdk/package.json',
      JSON.stringify({ name: '@anthropic-ai/sdk', version: '6.4.0', types: 'index.d.ts' }),
    );
    process.env.VALIDATE_CONTEXT = context({ package: '@anthropic-ai/sdk', version: '6.4.0-beta.2' });

    assert.equal(await check.run(), undefined);
  });

  it('fails when the installed prerelease is older than the required prerelease', async () => {
    await typescriptProject("import { create } from '@anthropic-ai/sdk';\ncreate({ model: 'x' });\n");
    await write(
      'node_modules/@anthropic-ai/sdk/package.json',
      JSON.stringify({ name: '@anthropic-ai/sdk', version: '6.4.0-beta.1', types: 'index.d.ts' }),
    );
    process.env.VALIDATE_CONTEXT = context({ package: '@anthropic-ai/sdk', version: '6.4.0-beta.2' });

    assert.equal(
      await check.run(),
      '@anthropic-ai/sdk@6.4.0-beta.1 is installed, and the change requires 6.4.0-beta.2',
    );
  });

  it('fails when the installed SDK is an older release than the one required', async () => {
    await typescriptProject("import { create } from '@anthropic-ai/sdk';\ncreate({ model: 'x' });\n");
    await write(
      'node_modules/@anthropic-ai/sdk/package.json',
      JSON.stringify({ name: '@anthropic-ai/sdk', version: '0.9.0', types: 'index.d.ts' }),
    );
    process.env.VALIDATE_CONTEXT = context({ package: '@anthropic-ai/sdk', version: '0.123.0' });

    assert.equal(
      await check.run(),
      '@anthropic-ai/sdk@0.9.0 is installed, and the change requires 0.123.0',
    );
  });

  it('fails when the required SDK is not the one installed', async () => {
    await typescriptProject("import { create } from '@anthropic-ai/sdk';\ncreate({ model: 'x' });\n");
    await write(
      'node_modules/@anthropic-ai/sdk/package.json',
      JSON.stringify({ name: '@anthropic-ai/sdk', version: '0.30.0', types: 'index.d.ts' }),
    );

    assert.equal(
      await check.run(),
      '@anthropic-ai/sdk@0.30.0 is installed, and the change requires 0.60.0',
    );
  });

  it('fails when the required SDK is not installed', async () => {
    await write('tsconfig.json', '{}\n');
    await write('package.json', JSON.stringify({ dependencies: { '@anthropic-ai/sdk': SDK.version } }));

    assert.equal(await check.run(), '@anthropic-ai/sdk@0.60.0 is not installed');
  });

  it('skips a TypeScript package that does not depend on the SDK', async () => {
    await write('tsconfig.json', '{}\n');
    await write('package.json', JSON.stringify({ name: 'web', version: '1.0.0' }));

    assert.equal(await check.run(), undefined);
  });

  it('fails when a TypeScript repository has no compiler', async () => {
    await write('package.json', JSON.stringify({ dependencies: { '@anthropic-ai/sdk': SDK.version } }));
    await write('tsconfig.json', '{}\n');
    await write(
      'node_modules/@anthropic-ai/sdk/package.json',
      JSON.stringify({ name: '@anthropic-ai/sdk', version: '0.60.0' }),
    );

    assert.match(await check.run() ?? '', /no TypeScript compiler/);
  });

  it('refuses a package name that is a path', async () => {
    await write('tsconfig.json', '{}\n');
    process.env.VALIDATE_CONTEXT = context({ package: '../secrets', version: '1.0.0' });

    assert.match(await check.run() ?? '', /refusing to typecheck a package path/);
  });

  describe('across packages that share one API change', () => {
    const declaration = 'export interface MessageCreateParams { model: string }\nexport function create(body: MessageCreateParams): void;\n';
    const tsconfig = {
      compilerOptions: {
        strict: true,
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'ES2022',
        skipLibCheck: true,
        incremental: false,
      },
      include: ['src'],
    };

    function apiChangeEnv(files: string[]): void {
      Object.assign(process.env, {
        MIGRATION_KIND: 'api_change',
        API_CHANGE: JSON.stringify({
          provider: 'anthropic',
          kind: 'param_removed',
          field: 'max_tokens',
          evidence: 'Removed max_tokens',
          sourceUrl: 'https://example.com/replay',
        }),
        TARGET_FILES: JSON.stringify(files),
        REPO_URL: 'https://github.com/acme/api.git',
        REPO_FULL_NAME: 'acme/api',
        BRANCH_NAME: 'replay',
        LLM_MODEL: 'test',
      });
    }

    async function packageAt(
      directory: string,
      manifest: Record<string, unknown>,
      source: string | undefined,
    ): Promise<void> {
      await write(`${directory}/package.json`, JSON.stringify(manifest));
      await write(`${directory}/tsconfig.json`, JSON.stringify(tsconfig));
      if (source !== undefined) await write(`${directory}/src/chat.ts`, source);
    }

    async function installSdk(directory: string): Promise<void> {
      await write(
        `${directory}/node_modules/@anthropic-ai/sdk/package.json`,
        JSON.stringify({ name: '@anthropic-ai/sdk', version: '0.60.0', types: 'index.d.ts' }),
      );
      await write(`${directory}/node_modules/@anthropic-ai/sdk/index.d.ts`, declaration);
      await fs.symlink(TYPESCRIPT_DIR, path.join(repoDir, directory, 'node_modules', 'typescript'), 'dir');
    }

    it('typechecks the package that depends on the SDK and skips TypeScript packages that do not', async () => {
      await packageAt('server/api', { name: 'api' }, "export const value = 1;\n");
      await packageAt(
        'server/sandbox',
        { name: 'sandbox', type: 'module', devDependencies: { '@anthropic-ai/sdk': '0.60.0' } },
        "import { create } from '@anthropic-ai/sdk';\ncreate({ model: 'x', max_tokens: 1 });\n",
      );
      await packageAt('web', { name: 'web' }, "export const page = 1;\n");
      await installSdk('server/sandbox');
      apiChangeEnv(['server/api/src/chat.ts', 'server/sandbox/src/chat.ts', 'web/src/chat.ts']);

      const reason = await check.run();

      assert.match(reason ?? '', /^server\/sandbox: @anthropic-ai\/sdk@0\.60\.0\n/);
      assert.match(reason ?? '', /max_tokens/);
      assert.equal(reason?.includes('is not installed'), false);
    });

    it('passes when the owning package typechecks and the others do not install the SDK', async () => {
      await packageAt('server/api', { name: 'api' }, "export const value = 1;\n");
      await packageAt(
        'server/sandbox',
        { name: 'sandbox', type: 'module', dependencies: { '@anthropic-ai/sdk': '0.60.0' } },
        "import { create } from '@anthropic-ai/sdk';\ncreate({ model: 'x' });\n",
      );
      await packageAt('web', { name: 'web' }, "export const page = 1;\n");
      await installSdk('server/sandbox');
      apiChangeEnv(['server/api/src/chat.ts', 'server/sandbox/src/chat.ts', 'web/src/chat.ts']);

      assert.equal(await check.run(), undefined);
    });

    it('still fails when the package that depends on the SDK does not have it installed', async () => {
      await packageAt('server/api', { name: 'api' }, "export const value = 1;\n");
      await packageAt(
        'server/sandbox',
        { name: 'sandbox', dependencies: { '@anthropic-ai/sdk': '0.60.0' } },
        "export const value = 1;\n",
      );
      apiChangeEnv(['server/api/src/chat.ts', 'server/sandbox/src/chat.ts']);

      assert.equal(await check.run(), 'server/sandbox: @anthropic-ai/sdk@0.60.0 is not installed');
    });
  });
});
