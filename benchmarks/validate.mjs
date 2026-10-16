// Proves each case is a real, solvable breaking change before it may be
// scored, using the same sandbox phases the benchmark runs:
//   1. the suite passes on the old version (baseline),
//   2. it fails after the upgrade alone (the break is real),
//   3. it passes again with the reference fix applied (the case is solvable).
// No model is involved. Writes benchmarks/results/validation.json.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  argSet,
  benchmarkConfig,
  createDriver,
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

const cases = await loadCases(argSet('only'));
const outArg = process.argv.find((arg) => arg.startsWith('--out='));
// Separate files let several authors validate in parallel without clobbering each other.
const outFile = outArg ? path.resolve(outArg.slice('--out='.length)) : path.join(resultsDir, 'validation.json');
const previous = JSON.parse(await fs.readFile(outFile, 'utf8').catch(() => '{"cases":[]}'));
const byId = new Map(previous.cases.map((entry) => [entry.id, entry]));

for (const spec of cases) {
  process.stdout.write(`validating ${spec.id} ... `);
  const record = await validate(spec);
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
