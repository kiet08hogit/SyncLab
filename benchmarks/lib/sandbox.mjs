// Runs benchmark cases through the worker's own sandbox driver, so every phase
// executes in the real synclab-sandbox image with the production container
// options. Nothing here reimplements a phase.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const casesDir = path.join(root, 'benchmarks', 'cases');
export const notesDir = path.join(root, 'benchmarks', 'notes');
export const resultsDir = path.join(root, 'benchmarks', 'results');

const apiRequire = createRequire(path.join(root, 'server', 'api', 'package.json'));
apiRequire('reflect-metadata');
const { DockerSandboxService } = apiRequire('./dist/worker/sandbox/docker-sandbox.service.js');
const { configuration } = apiRequire('./dist/config/configuration.js');

/** The image every phase runs in; built from server/sandbox by the scripts. */
export const IMAGE = process.env.BENCHMARK_IMAGE ?? 'synclab-sandbox:bench';
const SEED_IMAGE = 'node:22-bookworm-slim';

/**
 * The worker's configuration with no .env applied: the defaults a fresh
 * install gets (LLM provider, model, context, attempts, sandbox limits). Only
 * the image is pinned to the one the benchmark builds.
 */
export function benchmarkConfig() {
  const config = configuration();
  return { ...config, sandbox: { ...config.sandbox, image: IMAGE } };
}

export function createDriver(config = benchmarkConfig()) {
  const service = new DockerSandboxService({ get: (key) => config[key] });
  return {
    /** The worker's private runPhase, used exactly as its run() loop uses it. */
    runPhase: (phase, volumeName, params, attempt, extraEnv = {}) =>
      service.runPhase(phase, volumeName, params, attempt, extraEnv),
  };
}

export function jobParams(spec, config = benchmarkConfig()) {
  return {
    repoUrl: `https://example.invalid/synclab-benchmark/${spec.id}.git`,
    repoFullName: `synclab-benchmark/${spec.id}`,
    dependencyName: spec.package,
    targetVersion: spec.toVersion,
    branchName: `synclab/${spec.id}`,
    token: '',
    llm: config.llm,
  };
}

export function sh(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, output }));
  });
}

async function shOrThrow(command, args, options) {
  const result = await sh(command, args, options);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.code}): ${result.output}`);
  }
  return result;
}

/**
 * A fresh volume holding only the case's repository files and the release
 * notes snapshot. The case description, reference fix and expected answers
 * stay on the host, so the model cannot see them.
 */
export async function seedVolume(volumeName, repoDir, notes) {
  await shOrThrow('docker', ['volume', 'rm', '-f', volumeName]);
  await shOrThrow('docker', ['volume', 'create', '--label', 'com.synclab.benchmark=true', volumeName]);
  const notesFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'synclab-notes-')), 'notes.md');
  await fs.writeFile(notesFile, notes);
  await shOrThrow('docker', [
    'run', '--rm', '--network', 'none',
    '-v', `${volumeName}:/workspace`,
    '-v', `${repoDir}:/src:ro`,
    '-v', `${notesFile}:/notes.md:ro`,
    SEED_IMAGE, 'sh', '-c',
    'mkdir -p /workspace/repo /workspace/state && cp -a /src/. /workspace/repo/ && ' +
      // Cases store their manifest and lockfile as package.benchmark.json and
      // package-lock.benchmark.json so GitHub's dependency graph skips the deliberately old
      // versions; the sandbox sees a normal package.json and package-lock.json.
      'mv /workspace/repo/package.benchmark.json /workspace/repo/package.json && ' +
      'mv /workspace/repo/package-lock.benchmark.json /workspace/repo/package-lock.json && ' +
      'cp /notes.md /workspace/state/breaking-changes.md && chown -R node:node /workspace',
  ]);
  await fs.rm(path.dirname(notesFile), { recursive: true, force: true });
}

/** Copies files from the host into the checkout on the volume (used for reference fixes). */
export async function overlay(volumeName, fromDir) {
  await shOrThrow('docker', [
    'run', '--rm', '--network', 'none',
    '-v', `${volumeName}:/workspace`,
    '-v', `${fromDir}:/overlay:ro`,
    SEED_IMAGE, 'sh', '-c', 'cp -a /overlay/. /workspace/repo/ && chown -R node:node /workspace/repo',
  ]);
}

/** Copies the checkout (without node_modules) out of the volume for inspection. */
export async function extract(volumeName, toDir) {
  await fs.mkdir(toDir, { recursive: true });
  await shOrThrow('docker', [
    'run', '--rm', '--network', 'none',
    '-v', `${volumeName}:/workspace:ro`,
    '-v', `${toDir}:/out`,
    SEED_IMAGE, 'sh', '-c',
    'cd /workspace/repo && tar --exclude=./node_modules --exclude=./.yarn --exclude=./.pnp.cjs -cf - . | tar -xf - -C /out',
  ]);
}

export async function removeVolume(volumeName) {
  await sh('docker', ['volume', 'rm', '-f', volumeName]);
}

export async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out.sort();
}

export async function hashFiles(dir, files) {
  const hashes = {};
  for (const file of files) {
    hashes[file] = createHash('sha256').update(await fs.readFile(path.join(dir, file))).digest('hex');
  }
  return hashes;
}

export async function loadCases(only) {
  const ids = (await fs.readdir(casesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => !only || only.has(id))
    .sort();
  const cases = [];
  for (const id of ids) {
    const spec = JSON.parse(await fs.readFile(path.join(casesDir, id, 'case.json'), 'utf8'));
    if (spec.id !== id) throw new Error(`case.json id ${spec.id} does not match its directory ${id}`);
    cases.push({ ...spec, dir: path.join(casesDir, id) });
  }
  return cases;
}

export async function readNotes(id) {
  return fs.readFile(path.join(notesDir, `${id}.md`), 'utf8');
}

export function argSet(name) {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  return arg ? new Set(arg.slice(name.length + 3).split(',').filter(Boolean)) : null;
}
