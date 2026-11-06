import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { SandboxConfig } from './config.js';
import { projectDirectories } from './project-directories.js';

const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('projectDirectories', () => {
  it('finds the packages containing impacted files in a monorepo without a root manifest', async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), 'synclab-projects-'));
    temporary.push(repoDir);
    for (const packageName of ['api', 'web']) {
      await mkdir(path.join(repoDir, packageName, 'src'), { recursive: true });
      await writeFile(path.join(repoDir, packageName, 'package.json'), '{}');
    }
    const config = {
      repoDir,
      migration: { kind: 'api_change', files: ['web/src/page.ts', 'api/src/client.ts', 'web/src/other.ts'] },
    } as SandboxConfig;

    assert.deepEqual(await projectDirectories(config), [path.join(repoDir, 'api'), path.join(repoDir, 'web')]);
  });

  it('keeps a dependency migration at the repository root', async () => {
    const config = { repoDir: '/workspace/repo', migration: { kind: 'dependency' } } as SandboxConfig;
    assert.deepEqual(await projectDirectories(config), ['/workspace/repo']);
  });

  it('preserves root workspace orchestration', async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), 'synclab-workspace-'));
    temporary.push(repoDir);
    await mkdir(path.join(repoDir, 'packages', 'api'), { recursive: true });
    await writeFile(path.join(repoDir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    await writeFile(path.join(repoDir, 'packages', 'api', 'package.json'), '{}');
    const config = { repoDir, migration: { kind: 'api_change', files: ['packages/api/client.ts'] } } as SandboxConfig;
    assert.deepEqual(await projectDirectories(config), [repoDir]);
  });
});
