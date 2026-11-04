import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadWorkspace } from '../../config.js';
import { run } from '../../exec.js';
import { satisfiesMinimum } from '../../release-version.js';

const OUTPUT_LIMIT = 4_000;

interface TypecheckRequest {
  packageName: string;
  version: string;
}

/**
 * Typechecks a TypeScript repository against the installed SDK when that
 * release meets the required minimum. With no SDK named in VALIDATE_CONTEXT,
 * or no tsconfig.json, it passes. It uses the repository's own TypeScript
 * compiler and does not fetch anything.
 */
export const check = {
  name: 'typecheck',
  run: (): Promise<string | undefined> => typecheck(),
};

export async function typecheck(): Promise<string | undefined> {
  const request = readRequest(process.env.VALIDATE_CONTEXT);
  if (request === undefined) {
    return undefined;
  }
  if (request === 'invalid') {
    return 'VALIDATE_CONTEXT typecheck must be a package and a version';
  }

  const { repoDir } = loadWorkspace();
  try {
    await fs.access(path.join(repoDir, 'tsconfig.json'));
  } catch {
    return undefined;
  }

  const installed = await installedVersion(repoDir, request.packageName);
  if (installed === 'invalid-name') {
    return `refusing to typecheck a package path: ${request.packageName}`;
  }
  if (installed === undefined) {
    return `${request.packageName}@${request.version} is not installed`;
  }
  if (!satisfiesMinimum(installed, request.version)) {
    return `${request.packageName}@${installed} is installed, and the change requires ${request.version}`;
  }

  const tsc = path.join(repoDir, 'node_modules', 'typescript', 'lib', 'tsc.js');
  try {
    await fs.access(tsc);
  } catch {
    return `${request.packageName}@${installed} cannot be typechecked: the repository has no TypeScript compiler`;
  }

  const result = await run(
    process.execPath,
    [tsc, '--noEmit', '--pretty', 'false', '--incremental', 'false', '-p', 'tsconfig.json'],
    { cwd: repoDir },
  );
  if (result.code === 0) {
    return undefined;
  }

  const output = result.output.trim();
  const body = output.length > OUTPUT_LIMIT ? `${output.slice(0, OUTPUT_LIMIT)}\n[truncated]` : output;
  return body
    ? `${request.packageName}@${installed}\n${body}`
    : `${request.packageName}@${installed} failed typecheck with exit code ${result.code}`;
}

function readRequest(raw: string | undefined): TypecheckRequest | 'invalid' | undefined {
  if (!raw) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'invalid';
  }
  if (parsed === null || typeof parsed !== 'object' || !('typecheck' in parsed)) {
    return undefined;
  }

  const typecheck = parsed.typecheck;
  if (typecheck === null || typeof typecheck !== 'object') {
    return 'invalid';
  }
  const name = 'package' in typecheck ? typecheck.package : undefined;
  const version = 'version' in typecheck ? typecheck.version : undefined;
  if (typeof name !== 'string' || typeof version !== 'string' || !name.trim() || !version.trim()) {
    return 'invalid';
  }
  return { packageName: name, version };
}

/** npm package names are one segment, or a scope plus one segment. Nothing else is a path we will join. */
function packageDir(repoDir: string, name: string): string | undefined {
  if (name.includes('\\') || path.isAbsolute(name)) {
    return undefined;
  }
  const parts = name.split('/');
  if (parts.length > 2 || parts.some((part) => !part || part === '.' || part === '..')) {
    return undefined;
  }
  if (parts.length === 2 && !parts[0].startsWith('@')) {
    return undefined;
  }
  return path.join(repoDir, 'node_modules', ...parts);
}

async function installedVersion(repoDir: string, name: string): Promise<string | 'invalid-name' | undefined> {
  const dir = packageDir(repoDir, name);
  if (!dir) {
    return 'invalid-name';
  }

  try {
    const manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof manifest.version === 'string' ? normalizeVersion(manifest.version) : undefined;
  } catch {
    return undefined;
  }
}

function normalizeVersion(version: string): string {
  return version.replace(/^v/, '');
}
