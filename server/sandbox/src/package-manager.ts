import { promises as fs } from 'node:fs';
import path from 'node:path';

export type PackageManagerName = 'npm' | 'pnpm' | 'yarn';

export interface PackageManager {
  name: PackageManagerName;
  /** Yarn 2+ ("berry") takes different install flags from Yarn 1. */
  berry: boolean;
  hasLockfile: boolean;
  /** pnpm and Yarn 1 refuse to add to a workspace root without a flag. */
  workspaceRoot: boolean;
}

export interface Command {
  command: string;
  args: string[];
}

export type DependencySection =
  | 'dependencies'
  | 'devDependencies'
  | 'optionalDependencies'
  | 'peerDependencies';

const LOCKFILES: Record<PackageManagerName, string[]> = {
  npm: ['package-lock.json', 'npm-shrinkwrap.json'],
  pnpm: ['pnpm-lock.yaml'],
  yarn: ['yarn.lock'],
};

async function exists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}

async function anyExists(repoDir: string, names: string[]): Promise<boolean> {
  for (const name of names) {
    if (await exists(path.join(repoDir, name))) {
      return true;
    }
  }
  return false;
}

function parsePackageManagerField(value: unknown): { name: PackageManagerName; major?: number } | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^(npm|pnpm|yarn)@(\d+)?/.exec(value);
  if (!match) {
    return undefined;
  }
  return {
    name: match[1] as PackageManagerName,
    major: match[2] === undefined ? undefined : Number(match[2]),
  };
}

/**
 * The packageManager field is the repository's explicit choice, so it wins.
 * Without it the lockfile decides, and a repository with neither is npm.
 */
export async function detectPackageManager(repoDir: string): Promise<PackageManager> {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'),
  ) as { packageManager?: unknown; workspaces?: unknown };

  const declared = parsePackageManagerField(packageJson.packageManager);

  let name: PackageManagerName | undefined = declared?.name;
  if (!name) {
    for (const candidate of ['pnpm', 'yarn', 'npm'] as const) {
      if (await anyExists(repoDir, LOCKFILES[candidate])) {
        name = candidate;
        break;
      }
    }
  }
  name ??= 'npm';

  // A declared version is authoritative; .yarnrc.yml only decides without one.
  const berry =
    name === 'yarn' &&
    (declared?.name === 'yarn' && declared.major !== undefined
      ? declared.major >= 2
      : await exists(path.join(repoDir, '.yarnrc.yml')));

  const workspaceRoot =
    name === 'pnpm'
      ? await exists(path.join(repoDir, 'pnpm-workspace.yaml'))
      : name === 'yarn' && !berry && packageJson.workspaces !== undefined;

  return { name, berry, hasLockfile: await anyExists(repoDir, LOCKFILES[name]), workspaceRoot };
}

/**
 * pnpm and yarn are run through corepack, which honours the packageManager
 * version. Plain npm ships with Node and is run directly.
 */
function invoke(pm: PackageManager, args: string[]): Command {
  return pm.name === 'npm'
    ? { command: 'npm', args }
    : { command: 'corepack', args: [pm.name, ...args] };
}

/** A lockfile is honoured exactly; without one the install creates it. */
export function installCommand(pm: PackageManager): Command {
  switch (pm.name) {
    case 'npm':
      return invoke(pm, [pm.hasLockfile ? 'ci' : 'install', '--no-audit', '--no-fund']);
    case 'pnpm':
      return invoke(pm, ['install', ...(pm.hasLockfile ? ['--frozen-lockfile'] : [])]);
    case 'yarn':
      if (!pm.hasLockfile) {
        return invoke(pm, ['install']);
      }
      return invoke(pm, ['install', pm.berry ? '--immutable' : '--frozen-lockfile']);
  }
}

const SECTION_FLAGS: Record<PackageManagerName, Record<DependencySection, string[]>> = {
  npm: {
    dependencies: [],
    devDependencies: ['--save-dev'],
    optionalDependencies: ['--save-optional'],
    peerDependencies: ['--save-peer'],
  },
  pnpm: {
    dependencies: [],
    devDependencies: ['--save-dev'],
    optionalDependencies: ['--save-optional'],
    peerDependencies: ['--save-peer'],
  },
  // The long forms are spelled the same in Yarn 1 and Yarn 2+.
  yarn: {
    dependencies: [],
    devDependencies: ['--dev'],
    optionalDependencies: ['--optional'],
    peerDependencies: ['--peer'],
  },
};

const WORKSPACE_ROOT_FLAG: Record<PackageManagerName, string[]> = {
  npm: [],
  pnpm: ['--workspace-root'],
  yarn: ['--ignore-workspace-root-check'],
};

const EXACT_FLAG: Record<PackageManagerName, string> = {
  npm: '--save-exact',
  pnpm: '--save-exact',
  yarn: '--exact',
};

/**
 * Keeps the dependency in its current section, and keeps an exact pin exact.
 * Lifecycle scripts are allowed: the phase that runs this has no token.
 */
export function addCommand(
  pm: PackageManager,
  spec: string,
  section: DependencySection,
  exact: boolean,
): Command {
  const verb = pm.name === 'npm' ? 'install' : 'add';
  return invoke(pm, [
    verb,
    spec,
    ...SECTION_FLAGS[pm.name][section],
    ...(exact ? [EXACT_FLAG[pm.name]] : []),
    ...(pm.workspaceRoot ? WORKSPACE_ROOT_FLAG[pm.name] : []),
    ...(pm.name === 'npm' ? ['--no-audit', '--no-fund'] : []),
  ]);
}

export function testCommand(pm: PackageManager): Command {
  return invoke(pm, ['test']);
}

/**
 * Each phase is a fresh container, so anything a package manager caches in the
 * home directory is gone by the next phase. The test phase has no network, so
 * corepack's copy of pnpm or yarn, and Yarn 2+'s package cache that Plug'n'Play
 * reads at runtime, have to live on the job volume.
 */
export function packageManagerEnv(workspace: string): NodeJS.ProcessEnv {
  return {
    COREPACK_HOME: path.join(workspace, '.corepack'),
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    // Without a packageManager field, resolve corepack's bundled default
    // rather than asking the registry for "latest", which the test phase
    // cannot reach.
    COREPACK_DEFAULT_TO_LATEST: '0',
    YARN_GLOBAL_FOLDER: path.join(workspace, '.yarn-global'),
    YARN_ENABLE_TELEMETRY: '0',
  };
}
