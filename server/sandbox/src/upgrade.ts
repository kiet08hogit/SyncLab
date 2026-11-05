import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import lockfile from '@yarnpkg/lockfile';
import { unzipSync } from 'fflate';
import { run } from './exec.js';
import { addCommand, type DependencySection, type PackageManager } from './package-manager.js';
import { satisfiesMinimum } from './release-version.js';
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

function packageNameParts(name: string): string[] | undefined {
  const parts = name.split('/');
  if (
    name.includes('\\') ||
    path.isAbsolute(name) ||
    parts.length > 2 ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    (parts.length === 2 && !parts[0].startsWith('@'))
  ) {
    return undefined;
  }

  return parts;
}

async function readInstalledVersion(repoDir: string, name: string): Promise<string | undefined> {
  const parts = packageNameParts(name);
  if (!parts) return undefined;

  try {
    const manifest = JSON.parse(
      await fs.readFile(path.join(repoDir, 'node_modules', ...parts, 'package.json'), 'utf8'),
    ) as { version?: unknown };
    return typeof manifest.version === 'string' ? normalizeVersion(manifest.version) : undefined;
  } catch {
    return undefined;
  }
}

type PnpPackage = { packageLocation: string; packageDependencies: Array<[string, string | [string, string] | null]> };
type PnpState = { packageRegistryData: Array<[string | null, Array<[string | null, PnpPackage]>]> };

/** Read Yarn's generated resolution map as data, without running repository code. */
async function readPnpState(repoDir: string): Promise<PnpState | undefined> {
  try {
    const source = await fs.readFile(path.join(repoDir, '.pnp.cjs'), 'utf8');
    const ast = parse(source, { sourceType: 'script' });
    for (const statement of ast.program.body) {
      if (statement.type !== 'VariableDeclaration') continue;
      for (const declaration of statement.declarations) {
        if (declaration.id.type === 'Identifier' && declaration.id.name === 'RAW_RUNTIME_STATE'
          && declaration.init?.type === 'StringLiteral') {
          return JSON.parse(declaration.init.value) as PnpState;
        }
      }
    }

    const setup = ast.program.body.find((statement) =>
      statement.type === 'FunctionDeclaration' && statement.id?.name === '$$SETUP_STATE');
    if (setup?.type !== 'FunctionDeclaration') return undefined;
    const external = setup.body.body.some((statement) => statement.type === 'VariableDeclaration'
      && statement.declarations.some((declaration) => {
        const init = declaration.init;
        return declaration.id.type === 'Identifier' && declaration.id.name === 'pnpDataFilepath'
          && init?.type === 'CallExpression' && init.callee.type === 'MemberExpression'
          && init.callee.object.type === 'Identifier' && init.callee.object.name === 'path'
          && init.callee.property.type === 'Identifier' && init.callee.property.name === 'resolve'
          && init.arguments.length === 2 && init.arguments[0].type === 'Identifier'
          && init.arguments[0].name === '__dirname' && init.arguments[1].type === 'StringLiteral'
          && init.arguments[1].value === '.pnp.data.json';
      }));
    if (!external) return undefined;
    return JSON.parse(await fs.readFile(path.join(repoDir, '.pnp.data.json'), 'utf8')) as PnpState;
  } catch {
    return undefined;
  }
}

const PNP_VIRTUAL = /^(\/(?:[^/]+\/)*?(?:\$\$virtual|__virtual__))((?:\/((?:[^/]+-)?[a-f0-9]+)(?:\/([^/]+))?)?((?:\/.*)?))$/;

/** Map a Yarn PnP virtual locator onto the zip or unplugged folder it stores. */
function resolvePnpPhysical(location: string): string {
  let current = location;
  for (;;) {
    const match = PNP_VIRTUAL.exec(current);
    if (!match || (!match[3] && match[5])) return current;

    const slash = match[1].lastIndexOf('/');
    const target = slash > 0 ? match[1].slice(0, slash) : '/';
    if (!match[3] || !match[4]) return target;
    if (!/^[0-9]+$/.test(match[4])) return current;

    const next = path.posix.join(target, '../'.repeat(Number(match[4])), match[5] || '.');
    if (next === current) return current;
    current = next;
  }
}

/** Inspect the actual artifact selected by the root workspace's PnP map. */
async function readPnpInstalledVersion(repoDir: string, name: string, state: PnpState): Promise<string | undefined> {
  try {
    const registry = state.packageRegistryData;
    const roots = registry.flatMap(([, references]) =>
      references.map(([, info]) => info).filter((info) => info.packageLocation === './'));
    const dependency = roots
      .map((root) => root.packageDependencies.find(([dependencyName]) => dependencyName === name)?.[1])
      .find((reference) => reference !== undefined);
    if (!dependency) return undefined;
    const [packageName, reference] = Array.isArray(dependency) ? dependency : [name, dependency];
    const info = registry.find(([entryName]) => entryName === packageName)?.[1]
      .find(([entryReference]) => entryReference === reference)?.[1];
    if (!info) return undefined;

    const location = resolvePnpPhysical(path.resolve(repoDir, info.packageLocation));
    const zipBoundary = location.indexOf('.zip/');
    let manifestText: string;
    if (zipBoundary >= 0) {
      const archive = await fs.readFile(location.slice(0, zipBoundary + 4));
      const entry = path.posix.join(location.slice(zipBoundary + 5), 'package.json');
      const files = unzipSync(archive, { filter: (file) => file.name === entry });
      const manifest = files[entry];
      if (!manifest) return undefined;
      manifestText = Buffer.from(manifest).toString('utf8');
    } else {
      manifestText = await fs.readFile(path.join(location, 'package.json'), 'utf8');
    }
    const manifest = JSON.parse(manifestText) as { version?: unknown };
    return typeof manifest.version === 'string' ? normalizeVersion(manifest.version) : undefined;
  } catch {
    return undefined;
  }
}

async function readYarnInstalledVersion(repoDir: string, name: string): Promise<string | undefined> {
  if (!packageNameParts(name)) return undefined;
  const state = await readPnpState(repoDir);
  if (state) return readPnpInstalledVersion(repoDir, name, state);
  try {
    await fs.access(path.join(repoDir, '.pnp.cjs'));
    return undefined;
  } catch {
    return readInstalledVersion(repoDir, name);
  }
}

/** Yarn Classic has no command for assigning a range to an already chosen release. */
async function keepClassicYarnResolution(repoDir: string, name: string, version: string): Promise<void> {
  const lockPath = path.join(repoDir, 'yarn.lock');
  const parsed = lockfile.parse(await fs.readFile(lockPath, 'utf8'));
  const exact = parsed.object[`${name}@${version}`];
  if (parsed.type !== 'success' || !exact || exact.version !== version) {
    throw new Error(`could not locate ${name}@${version} in yarn.lock`);
  }
  parsed.object[`${name}@^${version}`] = exact;
  await fs.writeFile(lockPath, lockfile.stringify(parsed.object));
}

async function keepYarnRange(
  repoDir: string,
  pm: PackageManager,
  name: string,
  version: string,
  section: DependencySection,
  env: NodeJS.ProcessEnv,
): Promise<{ command: string; args: string[]; result: Awaited<ReturnType<typeof run>> }> {
  if (!pm.berry) {
    await keepClassicYarnResolution(repoDir, name, version);
  }

  const manifestPath = path.join(repoDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as PackageJson;
  manifest[section]![name] = `^${version}`;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const command = 'corepack';
  const args = pm.berry
    ? ['yarn', 'set', 'resolution', `${name}@npm:^${version}`, `npm:${version}`]
    : ['yarn', 'install', '--frozen-lockfile'];
  return { command, args, result: await run(command, args, { cwd: repoDir, env }) };
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
  options: { minimum?: boolean } = {},
): Promise<UpgradeOutcome> {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'),
  ) as PackageJson;

  const found = findDependency(packageJson, name);
  if (!found) {
    const error = `${name} is not a direct dependency in package.json, so it cannot be upgraded`;
    return { ok: false, error, step: { step: 'UPGRADE', output: error } };
  }

  const required = normalizeVersion(version);
  if (options.minimum) {
    const installed = pm.name === 'yarn' && pm.berry
      ? await readYarnInstalledVersion(repoDir, name)
      : await readInstalledVersion(repoDir, name);
    if (installed && satisfiesMinimum(installed, required)) {
      const output = `${name}@${installed} is already installed, which meets the required ${required}`;
      return { ok: true, step: { step: 'UPGRADE', output, exitCode: 0 } };
    }
  }

  // Always the exact target, so the suite runs against the version being
  // migrated to. A range would install the newest match instead.
  const spec = `${name}@${required}`;
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

  if (pm.name === 'yarn' && !found.exact) {
    const followUp = await keepYarnRange(repoDir, pm, name, required, found.section, env);
    step.output += `\n$ ${followUp.command} ${followUp.args.join(' ')}\n${followUp.result.output}`;
    step.exitCode = followUp.result.code;
    // Yarn may use Plug'n'Play or omit an optional package on this OS. The
    // Classic lock entry and the Yarn commands verify the chosen resolution.
    if (followUp.result.code !== 0) {
      return { ok: false, error: `could not keep ${name}@${required} ranged in Yarn`, step };
    }
  }

  return { ok: true, step };
}
