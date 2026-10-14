import { promises as fs } from 'node:fs';
import path from 'node:path';
import { run } from './exec.js';
import type { StepLog } from './result.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * Checked in this order so a package listed in more than one section stays in
 * the one npm itself treats as authoritative.
 */
const SECTIONS = [
  ['dependencies', []],
  ['devDependencies', ['--save-dev']],
  ['optionalDependencies', ['--save-optional']],
  ['peerDependencies', ['--save-peer']],
] as const;

export interface UpgradeOutcome {
  ok: boolean;
  error?: string;
  step: StepLog;
}

/** Release tags are often "v1.2.3", which npm does not accept as a version. */
export function normalizeVersion(version: string): string {
  return version.replace(/^v/, '');
}

function isExactVersion(spec: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(spec);
}

/**
 * Returns undefined when the package is not a direct dependency: installing it
 * anyway would add a top-level dependency the repository never had.
 */
export function upgradeArgs(
  packageJson: PackageJson,
  name: string,
  version: string,
): string[] | undefined {
  for (const [section, saveFlags] of SECTIONS) {
    const current = packageJson[section]?.[name];
    if (current === undefined) {
      continue;
    }

    return [
      'install',
      `${name}@${normalizeVersion(version)}`,
      // A bare install would move a devDependency into dependencies.
      ...saveFlags,
      // Keep a pinned "1.2.3" pinned instead of turning it into "^1.2.3".
      ...(isExactVersion(current) ? ['--save-exact'] : []),
      // This phase holds the GitHub token; code from the new release must not run here.
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ];
  }

  return undefined;
}

/**
 * Updates node_modules, package.json and the lockfile together, so the test
 * phase runs against the target version and publish commits the bump.
 */
export async function upgradeDependency(
  repoDir: string,
  name: string,
  version: string,
): Promise<UpgradeOutcome> {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'),
  ) as PackageJson;

  const args = upgradeArgs(packageJson, name, version);
  if (!args) {
    const error = `${name} is not a direct dependency in package.json, so it cannot be upgraded`;
    return { ok: false, error, step: { step: 'UPGRADE', output: error } };
  }

  const result = await run('npm', args, { cwd: repoDir });
  const step = { step: 'UPGRADE', output: result.output, exitCode: result.code };

  if (result.code !== 0) {
    return { ok: false, error: `could not install ${name}@${normalizeVersion(version)}`, step };
  }

  return { ok: true, step };
}
