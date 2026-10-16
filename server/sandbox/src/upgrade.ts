import { promises as fs } from 'node:fs';
import path from 'node:path';
import { run } from './exec.js';
import { addCommand, type DependencySection, type PackageManager } from './package-manager.js';
import type { StepLog } from './result.js';

type PackageJson = Partial<Record<DependencySection, Record<string, string>>>;

/**
 * Checked in this order so a package listed in more than one section stays in
 * the one npm itself treats as authoritative.
 */
const SECTIONS: DependencySection[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

export interface UpgradeOutcome {
  ok: boolean;
  error?: string;
  step: StepLog;
}

/** Release tags are often "v1.2.3", which package managers do not accept as a version. */
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
export function findDependency(
  packageJson: PackageJson,
  name: string,
): { section: DependencySection; exact: boolean } | undefined {
  for (const section of SECTIONS) {
    const deps = packageJson[section];
    // Own properties only: a package named "constructor" is not inherited from Object.
    if (deps && Object.hasOwn(deps, name)) {
      const current = deps[name];
      // Keep a pinned "1.2.3" pinned instead of turning it into "^1.2.3".
      return { section, exact: isExactVersion(current) };
    }
  }
  return undefined;
}

/**
 * Updates the installed packages, package.json and the lockfile together, so
 * the test phase runs against the target version and publish commits the bump.
 */
export async function upgradeDependency(
  repoDir: string,
  pm: PackageManager,
  name: string,
  version: string,
  env: NodeJS.ProcessEnv = {},
): Promise<UpgradeOutcome> {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'),
  ) as PackageJson;

  const found = findDependency(packageJson, name);
  if (!found) {
    const error = `${name} is not a direct dependency in package.json, so it cannot be upgraded`;
    return { ok: false, error, step: { step: 'UPGRADE', output: error } };
  }

  // Always the exact target, so the suite runs against the version being
  // migrated to. A range would install the newest match instead.
  const spec = `${name}@${normalizeVersion(version)}`;
  const { command, args } = addCommand(pm, spec, found.section, found.exact);
  const result = await run(command, args, { cwd: repoDir, env });
  const step = {
    step: 'UPGRADE',
    output: `$ ${command} ${args.join(' ')}\n${result.output}`,
    exitCode: result.code,
  };

  if (result.code !== 0) {
    return { ok: false, error: `could not install ${spec}`, step };
  }

  return { ok: true, step };
}
