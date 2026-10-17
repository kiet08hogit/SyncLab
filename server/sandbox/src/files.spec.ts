import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { collectSourceFiles } from './files.js';

describe('collectSourceFiles', () => {
  let repoDir: string;

  async function touch(relativePath: string): Promise<void> {
    const filePath = path.join(repoDir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '');
  }

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-files-'));
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it('returns JavaScript and TypeScript sources sorted by path', async () => {
    for (const file of ['src/z.ts', 'src/a.tsx', 'src/m.mts', 'src/n.cts', 'index.js', 'lib/b.jsx', 'lib/c.mjs', 'lib/d.cjs']) {
      await touch(file);
    }

    assert.deepEqual(
      await collectSourceFiles(repoDir),
      ['index.js', 'lib/b.jsx', 'lib/c.mjs', 'lib/d.cjs', 'src/a.tsx', 'src/m.mts', 'src/n.cts', 'src/z.ts'].map((file) =>
        path.join(repoDir, file),
      ),
    );
  });

  it('skips files that are not source code', async () => {
    for (const file of ['README.md', 'package.json', 'src/styles.css', 'src/app.ts']) {
      await touch(file);
    }

    assert.deepEqual(await collectSourceFiles(repoDir), [path.join(repoDir, 'src/app.ts')]);
  });

  it('skips dependency, build and VCS directories at any depth', async () => {
    for (const dir of ['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo']) {
      await touch(`${dir}/ignored.js`);
      await touch(`packages/web/${dir}/ignored.js`);
    }
    await touch('packages/web/src/kept.js');

    assert.deepEqual(await collectSourceFiles(repoDir), [
      path.join(repoDir, 'packages/web/src/kept.js'),
    ]);
  });

  it('returns nothing for a repository without sources', async () => {
    assert.deepEqual(await collectSourceFiles(repoDir), []);
  });
});
