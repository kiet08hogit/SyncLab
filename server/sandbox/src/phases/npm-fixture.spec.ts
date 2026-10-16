/**
 * Shared fixtures for the phase specs that run real npm against a registry on
 * localhost. It holds no tests itself; it is named *.spec.ts only so that it is
 * compiled with the specs and never mistaken for production code.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runOrThrow } from '../exec.js';

export const DEPENDENCY = 'synclab-fixture-dep';

/** Written into the installed package directory by the fixture's postinstall script. */
export const POSTINSTALL_MARKER = 'postinstall-ran.txt';

export function restoreEnv(saved: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(process.env)) {
    if (!(name in saved)) {
      delete process.env[name];
    }
  }
  Object.assign(process.env, saved);
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await runOrThrow('git', args, { cwd })).output.trim();
}

export async function readJson(filePath: string): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function exists(filePath: string): Promise<boolean> {
  return fs
    .lstat(filePath)
    .then(() => true)
    .catch(() => false);
}

/**
 * npm runs as a child process, so the registry has to be a real server. It
 * serves a single package with versions 1.0.0, 2.0.0 and 2.1.0, each with a
 * postinstall script that records which version ran it.
 */
export async function startRegistry(root: string): Promise<{ server: Server; url: string }> {
  const tarballs = new Map<string, Buffer>();
  let packument: unknown;
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    if (url === `/${DEPENDENCY}`) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(packument));
      return;
    }
    const tarball = tarballs.get(url);
    if (tarball) {
      response.setHeader('content-type', 'application/octet-stream');
      response.end(tarball);
      return;
    }
    response.statusCode = 404;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const versions: Record<string, unknown> = {};
  // 2.1.0 is newer than every target the specs ask for, so a range request
  // would visibly install it instead of the exact target.
  for (const version of ['1.0.0', '2.0.0', '2.1.0']) {
    const scripts = {
      postinstall: `node -e "require('fs').writeFileSync('${POSTINSTALL_MARKER}', '${version}')"`,
    };
    const packageDir = path.join(root, `pkg-${version}`, 'package');
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name: DEPENDENCY, version, scripts }));
    await fs.writeFile(path.join(packageDir, 'index.js'), `module.exports = '${version}';\n`);
    const tarballPath = path.join(root, `${DEPENDENCY}-${version}.tgz`);
    await runOrThrow('tar', ['-czf', tarballPath, '-C', path.dirname(packageDir), 'package']);
    const tarball = await fs.readFile(tarballPath);
    const tarballUrl = `/tarballs/${DEPENDENCY}-${version}.tgz`;
    tarballs.set(tarballUrl, tarball);
    versions[version] = {
      name: DEPENDENCY,
      version,
      scripts,
      hasInstallScript: true,
      dist: {
        tarball: `${url}${tarballUrl}`,
        shasum: createHash('sha1').update(tarball).digest('hex'),
        integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
      },
    };
  }
  packument = { name: DEPENDENCY, 'dist-tags': { latest: '2.1.0' }, versions };

  return { server, url };
}

/** Keeps git and npm away from the developer's home directory and the public registry. */
export function isolatedEnv(root: string, home: string, registryUrl: string): Record<string, string> {
  return {
    HOME: home,
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Seed',
    GIT_AUTHOR_EMAIL: 'seed@example.com',
    GIT_COMMITTER_NAME: 'Seed',
    GIT_COMMITTER_EMAIL: 'seed@example.com',
    npm_config_registry: `${registryUrl}/`,
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_userconfig: path.join(home, '.npmrc'),
    npm_config_update_notifier: 'false',
    npm_config_ignore_scripts: 'false',
  };
}

/**
 * Creates a seed repository (optionally with an npm lockfile, generated
 * without running scripts) and pushes it to a bare origin.
 */
export async function createOrigin(
  root: string,
  name: string,
  packageJson: Record<string, unknown>,
  withLockfile: boolean,
): Promise<{ url: string; headSha: string }> {
  const seed = path.join(root, `${name}-seed`);
  const bare = path.join(root, `${name}.git`);
  await fs.mkdir(seed);
  await fs.writeFile(path.join(seed, 'package.json'), JSON.stringify(packageJson, null, 2));
  await fs.writeFile(path.join(seed, '.gitignore'), 'node_modules\n');
  if (withLockfile) {
    await runOrThrow('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: seed });
    await fs.rm(path.join(seed, 'node_modules'), { recursive: true, force: true });
  }
  await git(seed, 'init', '--initial-branch=main');
  await git(seed, 'add', '--all');
  await git(seed, 'commit', '-m', 'initial');
  await git(root, 'init', '--bare', '--initial-branch=main', bare);
  await git(seed, 'push', bare, 'main');
  return { url: pathToFileURL(bare).href, headSha: await git(seed, 'rev-parse', 'HEAD') };
}

/** What the prepare phase leaves on the job volume: a plain clone, nothing installed. */
export async function cloneInto(originUrl: string, repoDir: string): Promise<void> {
  await fs.mkdir(path.dirname(repoDir), { recursive: true });
  await runOrThrow('git', ['clone', originUrl, repoDir]);
}
