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
    await write('package.json', JSON.stringify({ name: 'fixture', type: 'module' }));
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

    assert.equal(await check.run(), '@anthropic-ai/sdk@0.60.0 is not installed');
  });

  it('fails when a TypeScript repository has no compiler', async () => {
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
});
