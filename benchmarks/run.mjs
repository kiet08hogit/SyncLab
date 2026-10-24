// Runs every validated case through SyncLab's real migration loop, exactly as
// the worker sequences it (install -> baseline test -> upgrade -> refactor/test
// up to LLM_MAX_ATTEMPTS), each phase in the production sandbox image with the
// production container options. Only prepare (clone) and publish (push, PR)
// are left out: the checkout is seeded from the case instead of cloned, and
// nothing is pushed.
//
// Success means the project's own test suite passes after the migration and
// no test file was modified. Results are appended after every case, so an
// interrupted run continues with --resume.
//
// An API change case runs as the worker runs an api_change job: its target
// files are the impact the scan confirms, and there is no upgrade. Its own
// suite passes before the migration too, so success also needs the case's
// contract tests, which play the provider after the change, to pass on the
// migrated tree. They are added only after the run, so the model never sees them.
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  argSet,
  benchmarkConfig,
  createDriver,
  extract,
  hashFiles,
  impactOf,
  isApiChange,
  jobParams,
  listFiles,
  loadCases,
  overlay,
  readNotes,
  removeVolume,
  resultsDir,
  root,
  seedVolume,
} from './lib/sandbox.mjs';

const config = benchmarkConfig();
const driver = createDriver(config);
const MAX_ATTEMPTS = config.llm.maxAttempts;

const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const outFile = outArg ? path.resolve(outArg.slice('--out='.length)) : path.join(resultsDir, 'results.json');
const resume = process.argv.includes('--resume');

// A rate-limited model call does not fail a production job: BullMQ retries it
// up to 3 times with exponential backoff from 2 minutes. The benchmark waits
// the same way and retries the attempt, and keeps the wait out of the
// migration time, since it measures the provider's quota rather than SyncLab.
const RATE_LIMIT_BACKOFF_MS = [120_000, 240_000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tail(text, lines = 30) {
  return (text ?? '').split('\n').slice(-lines).join('\n');
}

function stepsText(result) {
  return result.steps.map((step) => step.output).join('\n');
}

async function timed(fn) {
  const started = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - started };
}

/** Files under repo/ the migration changed, added or removed, excluding the dependency bump. */
async function compareTrees(originalDir, finalDir) {
  const before = await listFiles(originalDir);
  const after = await listFiles(finalDir);
  const ignored = new Set(['package.json', 'package-lock.json', 'package.benchmark.json', 'package-lock.benchmark.json']);
  const all = [...new Set([...before, ...after])].filter((file) => !ignored.has(file)).sort();
  const beforeHashes = await hashFiles(originalDir, before.filter((file) => !ignored.has(file)));
  const afterHashes = await hashFiles(finalDir, after.filter((file) => !ignored.has(file)));
  const changed = all.filter((file) => beforeHashes[file] !== afterHashes[file]);
  return {
    changedFiles: changed.filter((file) => !file.startsWith('test/')),
    modifiedTests: changed.filter((file) => file.startsWith('test/')),
  };
}

async function runCase(spec) {
  const volume = `synclab-bench-run-${spec.id}`;
  const apiChange = isApiChange(spec);
  let params = jobParams(spec, config);
  const notes = apiChange ? undefined : await readNotes(spec.id);
  const record = {
    id: spec.id,
    package: spec.package,
    fromVersion: spec.fromVersion,
    toVersion: spec.toVersion,
    category: spec.category,
    difficulty: spec.difficulty,
    model: `${config.llm.provider}/${config.llm.model}`,
    releaseNotesFound: apiChange ? null : !notes.startsWith('No release notes were found'),
    success: false,
    firstAttemptPassed: false,
    attemptsUsed: 0,
    failureCategory: null,
    failureReason: null,
    changedFiles: [],
    modifiedTests: [],
    attempts: [],
    timings: {},
  };
  const started = Date.now();

  try {
    await seedVolume(volume, path.join(spec.dir, 'repo'), notes);

    if (apiChange) {
      const impact = await timed(() => impactOf(driver, volume, spec));
      record.timings.scanMs = impact.ms;
      record.impactFiles = impact.value.files;
      if (impact.value.files.length === 0) {
        return fail(record, 'no_impact', `the scan does not confirm the change affects the case (impact: ${impact.value.confidence ?? 'none'})`);
      }
      params = jobParams(spec, config, impact.value.files);
    }

    const install = await timed(() => driver.runPhase('install', volume, params, 1));
    record.timings.installMs = install.ms;
    if (!install.value.ok) {
      return fail(record, 'install_failed', tail(stepsText(install.value)));
    }

    const baseline = await timed(() =>
      driver.runPhase('test', volume, params, 1, { TEST_BASELINE: 'true' }),
    );
    record.timings.baselineMs = baseline.ms;
    if (!baseline.value.ok) {
      return fail(record, 'baseline_failed', tail(stepsText(baseline.value)));
    }

    // Migration time: from the upgrade (or, for an API change, the first
    // refactor) to the last test run, which is the part of the job SyncLab is
    // responsible for.
    const migrationStarted = Date.now();
    if (!apiChange) {
      const upgrade = await timed(() => driver.runPhase('upgrade', volume, params, 1));
      record.timings.upgradeMs = upgrade.ms;
      if (!upgrade.value.ok) {
        return fail(record, 'upgrade_failed', tail(stepsText(upgrade.value)));
      }
    }

    let passed = false;
    let lastTestOutput = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      record.attemptsUsed = attempt;
      const entry = { attempt };
      record.attempts.push(entry);

      let refactor = await timed(() => driver.runPhase('refactor', volume, params, attempt));
      for (const wait of RATE_LIMIT_BACKOFF_MS) {
        if (refactor.value.ok || refactor.value.data?.retryable !== true) break;
        entry.rateLimitRetries = (entry.rateLimitRetries ?? 0) + 1;
        record.timings.rateLimitWaitMs = (record.timings.rateLimitWaitMs ?? 0) + wait + refactor.ms;
        await sleep(wait);
        refactor = await timed(() => driver.runPhase('refactor', volume, params, attempt));
      }
      entry.refactorMs = refactor.ms;
      entry.refactorOk = refactor.value.ok;
      entry.refactorChangedFiles = refactor.value.data?.changedFiles ?? [];
      entry.refactorLog = tail(stepsText(refactor.value), 40);
      if (!refactor.value.ok) {
        record.timings.migrationMs = Date.now() - migrationStarted - (record.timings.rateLimitWaitMs ?? 0);
        const limited = refactor.value.data?.retryable === true;
        return fail(record, limited ? 'rate_limited' : 'model_error', refactor.value.error ?? 'refactor failed');
      }

      const tested = await timed(() => driver.runPhase('test', volume, params, attempt));
      entry.testMs = tested.ms;
      entry.testPassed = tested.value.ok;
      lastTestOutput = stepsText(tested.value);
      entry.testTail = tail(lastTestOutput, 25);
      if (tested.value.ok) {
        passed = true;
        break;
      }
    }
    record.timings.migrationMs = Date.now() - migrationStarted - (record.timings.rateLimitWaitMs ?? 0);

    const finalDir = await fs.mkdtemp(path.join(os.tmpdir(), `synclab-bench-${spec.id}-`));
    await extract(volume, finalDir);
    const diff = await compareTrees(path.join(spec.dir, 'repo'), finalDir);
    await fs.rm(finalDir, { recursive: true, force: true });
    record.changedFiles = diff.changedFiles;
    record.modifiedTests = diff.modifiedTests;

    if (diff.modifiedTests.length > 0) {
      return fail(record, 'tests_modified', `the migration changed ${diff.modifiedTests.join(', ')}`);
    }
    if (!passed) {
      return fail(
        record,
        diff.changedFiles.length === 0 ? 'no_changes' : 'tests_failed',
        tail(lastTestOutput, 25),
      );
    }

    if (apiChange) {
      await overlay(volume, path.join(spec.dir, 'contract'));
      const contract = await timed(() => driver.runPhase('test', volume, params, record.attemptsUsed));
      record.timings.contractMs = contract.ms;
      record.contractPassed = contract.value.ok;
      if (!contract.value.ok) {
        return fail(record, 'api_still_broken', tail(stepsText(contract.value), 25));
      }
    }

    record.success = true;
    record.firstAttemptPassed = record.attemptsUsed === 1;
    return record;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(record, /exceeded \d+ms and was killed/.test(message) ? 'timeout' : 'harness_error', message);
  } finally {
    record.timings.totalMs = Date.now() - started;
    await removeVolume(volume);
  }
}

function fail(record, category, reason) {
  record.failureCategory = category;
  record.failureReason = reason;
  return record;
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function modelInfo() {
  // Whether the model is the worker's default for the provider, or overridden.
  const source = process.env.LLM_MODEL ? 'LLM_MODEL override' : 'worker default';
  return { provider: config.llm.provider, model: config.llm.model, source };
}

const validation = JSON.parse(await fs.readFile(path.join(resultsDir, 'validation.json'), 'utf8'));
const validIds = new Set(validation.cases.filter((entry) => entry.valid).map((entry) => entry.id));
const only = argSet('only');
const cases = (await loadCases(only)).filter((spec) => validIds.has(spec.id));
const skippedInvalid = (await loadCases(only)).filter((spec) => !validIds.has(spec.id)).map((spec) => spec.id);

const previous = resume ? JSON.parse(await fs.readFile(outFile, 'utf8').catch(() => 'null')) : null;
const done = new Map((previous?.results ?? []).map((entry) => [entry.id, entry]));
const meta = previous?.meta ?? {
  startedAt: new Date().toISOString(),
  commit: git('rev-parse', 'HEAD'),
  dirty: git('status', '--porcelain', '--', 'server').length > 0,
  image: config.sandbox.image,
  imageId: execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', config.sandbox.image], {
    encoding: 'utf8',
  }).trim(),
  model: modelInfo(),
  maxAttempts: MAX_ATTEMPTS,
  sandbox: {
    memoryBytes: config.sandbox.memoryBytes,
    nanoCpus: config.sandbox.nanoCpus,
    pidsLimit: config.sandbox.pidsLimit,
    timeoutMs: config.sandbox.timeoutMs,
  },
  host: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, node: process.version },
};
if (skippedInvalid.length > 0) {
  console.log(`skipping ${skippedInvalid.length} case(s) not marked valid in validation.json: ${skippedInvalid.join(', ')}`);
}

async function save() {
  const results = [...done.values()].sort((a, b) => a.id.localeCompare(b.id));
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(
    outFile,
    `${JSON.stringify({ meta: { ...meta, finishedAt: new Date().toISOString(), cases: results.length }, results }, null, 2)}\n`,
  );
}

meta.commits = [...new Set([...(meta.commits ?? [meta.commit]), git('rev-parse', 'HEAD')])];
meta.models = [...new Set([...(meta.models ?? [`${meta.model.provider}/${meta.model.model}`]), `${config.llm.provider}/${config.llm.model}`])];

for (const [index, spec] of cases.entries()) {
  if (done.has(spec.id)) continue;
  process.stdout.write(`[${index + 1}/${cases.length}] ${spec.id} ... `);
  const record = await runCase(spec);
  // A spent daily quota says nothing about the migration: leave the case
  // unrecorded so --resume runs it again, possibly with another model.
  if (record.failureCategory === 'rate_limited' && /PerDay/.test(record.failureReason ?? '')) {
    process.stdout.write(`daily quota for ${config.llm.model} is spent; stopping without recording this case\n`);
    await save();
    process.exit(3);
  }
  done.set(spec.id, record);
  await save();
  process.stdout.write(
    record.success
      ? `passed on attempt ${record.attemptsUsed} (${Math.round(record.timings.migrationMs / 1000)}s)\n`
      : `FAILED: ${record.failureCategory}\n`,
  );
}
await save();
console.log(`wrote ${path.relative(process.cwd(), outFile)}`);
