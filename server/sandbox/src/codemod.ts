import { promises as fs } from 'node:fs';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
]);

export interface CodemodResult {
  changedFiles: string[];
  replacements: number;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        yield* walk(fullPath);
      }
      continue;
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      yield fullPath;
    }
  }
}

/**
 * Phase 3 replaces this with the LangChain refactoring chain. Everything around
 * it - the offline container, the test run, the PR - stays the same.
 */
export async function applyCodemod(
  repoDir: string,
  search: string,
  replace: string,
): Promise<CodemodResult> {
  const changedFiles: string[] = [];
  let replacements = 0;

  for await (const filePath of walk(repoDir)) {
    const contents = await fs.readFile(filePath, 'utf8');
    const occurrences = contents.split(search).length - 1;

    if (occurrences === 0) {
      continue;
    }

    await fs.writeFile(filePath, contents.split(search).join(replace), 'utf8');
    changedFiles.push(path.relative(repoDir, filePath));
    replacements += occurrences;
  }

  return { changedFiles, replacements };
}
