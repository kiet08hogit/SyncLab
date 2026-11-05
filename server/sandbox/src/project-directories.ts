import { access } from 'node:fs/promises';
import path from 'node:path';
import type { SandboxConfig } from './config.js';

async function hasManifest(directory: string): Promise<boolean> {
  return access(path.join(directory, 'package.json')).then(() => true, () => false);
}

/** Run an API migration's install and tests in each package containing an impacted file. */
export async function projectDirectories(config: SandboxConfig): Promise<string[]> {
  if (config.migration.kind !== 'api_change') return [config.repoDir];

  const projects = new Set<string>();
  for (const file of config.migration.files) {
    let directory = path.dirname(path.resolve(config.repoDir, file));
    const relative = path.relative(config.repoDir, directory);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Impacted file ${file} is outside the repository`);
    }
    for (;;) {
      if (await hasManifest(directory)) {
        projects.add(directory);
        break;
      }
      if (directory === config.repoDir) {
        throw new Error(`No package.json contains impacted file ${file}`);
      }
      directory = path.dirname(directory);
    }
  }
  return [...projects].sort();
}
