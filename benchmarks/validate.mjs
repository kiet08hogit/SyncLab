// Proves each case is a real, solvable breaking change before it may be
// scored, using the same sandbox phases the benchmark runs. No model is
// involved. Writes benchmarks/results/validation.json.
//
// A dependency case:
//   1. the suite passes on the old version (baseline),
//   2. it fails after the upgrade alone (the break is real),
//   3. it passes again with the reference fix applied (the case is solvable).
//
// An API change case keeps its SDK, so nothing in the repository changes when
// the provider does. Its contract/ tests play the provider after the change
// and are overlaid only here and after a run, never during one:
//   1. the scan confirms the change affects exactly the files case.json names,
//   2. the suite passes before the migration (baseline),
//   3. with the contract tests added, it fails (the break is real),
//   4. with the reference fix it passes, and the scan no longer matches the change.
// A case with a partial/ fix also proves that fix passes the repository's own
// suite while the scan still sees the change: what the validate gate rejects.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  argSet,
  benchmarkConfig,
  createDriver,
  impactOf,
  isApiChange,
  jobParams,
  listFiles,
  loadCases,
  overlay,
  removeVolume,
  resultsDir,
  seedVolume,
} from './lib/sandbox.mjs';

const config = benchmarkConfig();
const driver = createDriver(config);

function lastLines(result, count = 25) {
  const output = result.steps.map((step) => step.output).join('\n');
  return output.split('\n').slice(-count).join('\n');
}

/** Why a fixture directory is unusable, or undefined. Only contract/ may hold tests. */
async function fixtureProblem(spec, name, { tests }) {
  const files = await listFiles(path.join(spec.dir, name)).catch(() => []);
  if (files.length === 0) return `no files in ${name}/`;
  const inTest = files.filter((file) => file.startsWith('test/'));
  if (tests && inTest.length !== files.length) return `${name}/ may only hold files under test/`;
  if (!tests && inTest.length > 0) return `${name}/ must not change tests`;
  return undefined;
}

async function validate(spec) {
  const volume = `synclab-bench-validate-${spec.id}`;
  const params = jobParams(spec, config);
  const record = { id: spec.id, checks: {}, valid: false };

  const solutionFiles = await listFiles(path.join(spec.dir, 'solution')).catch(() => []);
  if (solutionFiles.length === 0) {
    record.reason = 'no reference fix in solution/';
    return record;
  }
  if (solutionFiles.some((file) => file.startsWith('test/'))) {
    record.reason = 'the reference fix must not change tests';
    return record;
  }

  try {
    await seedVolume(volume, path.join(spec.dir, 'repo'), 'Release notes are not used by validation.\n');

    const install = await driver.runPhase('install', volume, params, 1);
    record.checks.install = install.ok;
    if (!install.ok) return { ...record, reason: `install failed: ${lastLines(install)}` };

    const baseline = await driver.runPhase('test', volume, params, 1, { TEST_BASELINE: 'true' });
    record.checks.baselinePasses = baseline.ok;
    if (!baseline.ok) return { ...record, reason: `baseline failed on the old version: ${lastLines(baseline)}` };

    const upgrade = await driver.runPhase('upgrade', volume, params, 1);
    record.checks.upgrade = upgrade.ok;
    if (!upgrade.ok) return { ...record, reason: `upgrade failed: ${lastLines(upgrade)}` };

    const broken = await driver.runPhase('test', volume, params, 1);
    record.checks.breaksAfterUpgrade = !broken.ok;
    if (broken.ok) return { ...record, reason: 'tests still pass after the upgrade alone, so the break is not real' };

    await overlay(volume, path.join(spec.dir, 'solution'));
    const fixed = await driver.runPhase('test', volume, params, 1);
    record.checks.referenceFixPasses = fixed.ok;
    if (!fixed.ok) return { ...record, reason: `reference fix does not pass: ${lastLines(fixed)}` };

    return { ...record, valid: true };
  } catch (error) {
    return { ...record, reason: `validation error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await removeVolume(volume);
  }
}

async function validateApiChange(spec) {
  const volume = `synclab-bench-validate-${spec.id}`;
  const record = { id: spec.id, checks: {}, valid: false };
  const hasPartial = await fs.access(path.join(spec.dir, 'partial')).then(() => true, () => false);

  for (const [name, options] of [
    ['solution', { tests: false }],
    ['contract', { tests: true }],
    ...(hasPartial ? [['partial', { tests: false }]] : []),
  ]) {
    const problem = await fixtureProblem(spec, name, options);
    if (problem) return { ...record, reason: problem };
  }

  try {
    await seedVolume(volume, path.join(spec.dir, 'repo'));

    const impact = await impactOf(driver, volume, spec);
    record.impactFiles = impact.files;
    record.checks.impactConfirmed = impact.files.length > 0;
    if (!record.checks.impactConfirmed) {
      return { ...record, reason: `the scan does not confirm the change affects the case (impact: ${impact.confidence ?? 'none'})` };
    }
    record.checks.impactMatchesCase = JSON.stringify(impact.files) === JSON.stringify([...spec.impactFiles].sort());
    if (!record.checks.impactMatchesCase) {
      return { ...record, reason: `the scan names ${impact.files.join(', ')}, but case.json expects ${spec.impactFiles.join(', ')}` };
    }
    const params = jobParams(spec, config, impact.files);

    const install = await driver.runPhase('install', volume, params, 1);
    record.checks.install = install.ok;
    if (!install.ok) return { ...record, reason: `install failed: ${lastLines(install)}` };

    const baseline = await driver.runPhase('test', volume, params, 1, { TEST_BASELINE: 'true' });
    record.checks.baselinePasses = baseline.ok;
    if (!baseline.ok) return { ...record, reason: `baseline failed before the migration: ${lastLines(baseline)}` };

    if (hasPartial) {
      await overlay(volume, path.join(spec.dir, 'partial'));
      const partial = await driver.runPhase('test', volume, params, 1);
      record.checks.partialFixPassesTests = partial.ok;
      if (!partial.ok) return { ...record, reason: `the partial fix fails the repository's own suite: ${lastLines(partial)}` };
      const left = await impactOf(driver, volume, spec);
      record.checks.partialFixStillMatched = left.files.length > 0;
      if (!record.checks.partialFixStillMatched) {
        return { ...record, reason: 'the scan no longer matches the change after the partial fix, so validation could not reject it' };
      }
    }

    await overlay(volume, path.join(spec.dir, 'contract'));
    const broken = await driver.runPhase('test', volume, params, 1);
    record.checks.breaksOnNewApi = !broken.ok;
    if (broken.ok) {
      return { ...record, reason: `the contract tests pass ${hasPartial ? 'with the partial fix' : 'before the migration'}, so the break is not real` };
    }

    await overlay(volume, path.join(spec.dir, 'solution'));
    const fixed = await driver.runPhase('test', volume, params, 1);
    record.checks.referenceFixPasses = fixed.ok;
    if (!fixed.ok) return { ...record, reason: `reference fix does not pass: ${lastLines(fixed)}` };

    const after = await impactOf(driver, volume, spec);
    record.checks.referenceFixClearsImpact = after.confidence === null;
    if (!record.checks.referenceFixClearsImpact) {
      return { ...record, reason: `the scan still matches the change after the reference fix (impact: ${after.confidence})` };
    }

    return { ...record, valid: true };
  } catch (error) {
    return { ...record, reason: `validation error: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await removeVolume(volume);
  }
}

const cases = await loadCases(argSet('only'));
const outArg = process.argv.find((arg) => arg.startsWith('--out='));
// Separate files let several authors validate in parallel without clobbering each other.
const outFile = outArg ? path.resolve(outArg.slice('--out='.length)) : path.join(resultsDir, 'validation.json');
const previous = JSON.parse(await fs.readFile(outFile, 'utf8').catch(() => '{"cases":[]}'));
const byId = new Map(previous.cases.map((entry) => [entry.id, entry]));

for (const spec of cases) {
  process.stdout.write(`validating ${spec.id} ... `);
  const record = isApiChange(spec) ? await validateApiChange(spec) : await validate(spec);
  byId.set(spec.id, { ...record, validatedAt: new Date().toISOString() });
  process.stdout.write(record.valid ? 'valid\n' : `INVALID: ${record.reason.split('\n')[0]}\n`);
}

const all = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(
  outFile,
  `${JSON.stringify({ image: config.sandbox.image, cases: all }, null, 2)}\n`,
);
console.log(`${all.filter((entry) => entry.valid).length}/${all.length} cases valid -> ${path.relative(process.cwd(), outFile)}`);
