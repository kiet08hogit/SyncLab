// Builds results.csv and report.md from results.json and validation.json.
// Every number in the report is computed here from the recorded results.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const resultsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');

const inArg = process.argv.find((arg) => arg.startsWith('--in='));
const inFile = inArg ? path.resolve(inArg.slice('--in='.length)) : path.join(resultsDir, 'results.json');
const outDir = path.dirname(inFile);
const { meta, results } = JSON.parse(await fs.readFile(inFile, 'utf8'));
const validation = JSON.parse(await fs.readFile(path.join(resultsDir, 'validation.json'), 'utf8'));

const pct = (part, whole) => (whole === 0 ? 'n/a' : `${((100 * part) / whole).toFixed(1)}%`);
const sec = (ms) => (ms === undefined || ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)}s`);

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

const mean = (values) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

function summarize(rows) {
  const total = rows.length;
  const success = rows.filter((row) => row.success).length;
  const first = rows.filter((row) => row.firstAttemptPassed).length;
  const times = rows.map((row) => row.timings.migrationMs).filter((ms) => typeof ms === 'number');
  return { total, success, first, times };
}

function groupTable(title, key) {
  const groups = new Map();
  for (const row of results) {
    const value = row[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  const lines = [
    `### ${title}`,
    '',
    `| ${title.replace(/^By /, '')} | Cases | First-attempt pass | Success after retries | Mean migration time |`,
    '| --- | --- | --- | --- | --- |',
  ];
  for (const [value, rows] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])))) {
    const s = summarize(rows);
    lines.push(`| ${value} | ${s.total} | ${s.first} (${pct(s.first, s.total)}) | ${s.success} (${pct(s.success, s.total)}) | ${sec(mean(s.times))} |`);
  }
  return lines.join('\n');
}

// CSV: one row per case.
const columns = [
  'id', 'package', 'fromVersion', 'toVersion', 'category', 'difficulty', 'model', 'releaseNotesFound',
  'success', 'firstAttemptPassed', 'attemptsUsed', 'failureCategory', 'changedFiles', 'modifiedTests',
  'installMs', 'baselineMs', 'upgradeMs', 'migrationMs', 'totalMs',
];
const csvValue = (value) => {
  const text = Array.isArray(value) ? value.join(';') : value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csv = [
  columns.join(','),
  ...results.map((row) =>
    columns.map((column) => csvValue(column in row ? row[column] : row.timings[column])).join(','),
  ),
].join('\n');
await fs.writeFile(path.join(outDir, 'results.csv'), `${csv}\n`);

const all = summarize(results);
const failures = results.filter((row) => !row.success);
const failureCounts = new Map();
for (const row of failures) failureCounts.set(row.failureCategory, (failureCounts.get(row.failureCategory) ?? 0) + 1);
const successTimes = results.filter((row) => row.success).map((row) => row.timings.migrationMs);
const attemptsOnSuccess = new Map();
for (const row of results.filter((row) => row.success)) {
  attemptsOnSuccess.set(row.attemptsUsed, (attemptsOnSuccess.get(row.attemptsUsed) ?? 0) + 1);
}
const validCount = validation.cases.filter((entry) => entry.valid).length;
const packages = new Set(results.map((row) => row.package));
const notesFound = results.filter((row) => row.releaseNotesFound).length;
const withNotes = summarize(results.filter((row) => row.releaseNotesFound));
const withoutNotes = summarize(results.filter((row) => !row.releaseNotesFound));

const FAILURE_TEXT = {
  tests_failed: 'the model changed code but the suite still failed after the last attempt',
  no_changes: 'the model left every file unchanged on every attempt',
  model_error: 'the refactor phase failed (model unreachable, file too large for the context, cut-off reply)',
  rate_limited: 'the provider kept rate-limiting after the same retries BullMQ would make',
  tests_modified: 'the migration edited a test file (counted as a failure even if tests passed)',
  timeout: 'a phase exceeded the sandbox timeout',
  install_failed: 'dependency install failed',
  baseline_failed: 'the suite failed on the old version at run time',
  upgrade_failed: 'the upgrade to the target version failed',
  harness_error: 'the benchmark harness itself errored',
};

const summary = {
  cases: all.total,
  packages: packages.size,
  firstAttemptPassRate: all.total ? all.first / all.total : null,
  successRate: all.total ? all.success / all.total : null,
  meanMigrationMs: mean(all.times),
  medianMigrationMs: quantile(all.times, 0.5),
  p90MigrationMs: quantile(all.times, 0.9),
  meanMigrationMsOnSuccess: mean(successTimes),
  failures: Object.fromEntries(failureCounts),
};
await fs.writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

const report = `# SyncLab migration benchmark report

Generated from \`${path.basename(inFile)}\` by \`benchmarks/report.mjs\`. Every number below is computed from the recorded per-case results; nothing is estimated or hand-entered.

## Setup

| | |
| --- | --- |
| Run | ${meta.startedAt} to ${meta.finishedAt} |
| Base commit | ${(meta.commits ?? [meta.commit]).map((commit) => `\`${commit.slice(0, 12)}\``).join(', then ')}${(meta.commits ?? []).length > 1 ? ' (the run was resumed; the later commit only changed the benchmark harness)' : ''}${meta.dirty ? ' (server/ had uncommitted changes)' : ''} |
| Model | ${(meta.models ?? []).length > 1 ? `${meta.models.length} models, one per case (see By model); first: ` : ''}${meta.model.provider} \`${meta.model.model}\`${meta.model.source === 'LLM_MODEL override' ? ' (chosen with `LLM_MODEL`, not the worker\'s default for this provider)' : ''} |
| Attempts per case | up to ${meta.maxAttempts} (the worker's default \`LLM_MAX_ATTEMPTS\`) |
| Sandbox | image \`${meta.image}\` (\`${meta.imageId.slice(7, 19)}\`), ${meta.sandbox.memoryBytes / 1024 ** 3} GB memory, ${meta.sandbox.nanoCpus / 1e9} CPU, ${meta.sandbox.pidsLimit} PIDs, ${meta.sandbox.timeoutMs / 60000} min per phase |
| Host | ${meta.host.platform}/${meta.host.arch}, ${meta.host.cpus} CPUs; harness on Node ${meta.host.node}, phases on the image's Node 22 |
| Cases | ${all.total} scored across ${packages.size} packages (${validCount} passed validation) |

## Results

| Metric | Value |
| --- | --- |
| First-attempt test pass rate | ${all.first}/${all.total} (${pct(all.first, all.total)}) |
| Success rate after retries | ${all.success}/${all.total} (${pct(all.success, all.total)}) |
| Mean migration time | ${sec(mean(all.times))} |
| Median migration time | ${sec(quantile(all.times, 0.5))} |
| 90th percentile migration time | ${sec(quantile(all.times, 0.9))} |
| Mean migration time, successful cases | ${sec(mean(successTimes))} |

Successful cases by the attempt that passed: ${[...attemptsOnSuccess.entries()].sort((a, b) => a[0] - b[0]).map(([attempt, count]) => `attempt ${attempt}: ${count}`).join(', ') || 'none'}.

Release notes were found for ${notesFound} of ${all.total} cases. Success with notes: ${withNotes.success}/${withNotes.total} (${pct(withNotes.success, withNotes.total)}); without: ${withoutNotes.success}/${withoutNotes.total} (${pct(withoutNotes.success, withoutNotes.total)}). This is not a controlled comparison: the two groups contain different packages, difficulties and models.

### Failure reasons

| Reason | Cases | Meaning |
| --- | --- | --- |
${[...failureCounts.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => `| \`${category}\` | ${count} | ${FAILURE_TEXT[category] ?? ''} |`).join('\n') || '| none | 0 | |'}

${(meta.models ?? []).length > 1 ? `${groupTable('By model', 'model')}

` : ''}${groupTable('By difficulty', 'difficulty')}

${groupTable('By category', 'category')}

${groupTable('By package', 'package')}

### Failed cases

| Case | Reason | Attempts | Files changed |
| --- | --- | --- | --- |
${failures.map((row) => `| \`${row.id}\` | \`${row.failureCategory}\` | ${row.attemptsUsed} | ${row.changedFiles.length ? row.changedFiles.map((file) => `\`${file}\``).join(', ') : 'none'} |`).join('\n') || '| none | | | |'}

## Methodology

**Cases.** Each case is a small project pinned (with a lockfile) to an older release of one npm package whose newer release has a real breaking change: a removed or renamed API, a changed signature or default export, an ESM-only release, or a behaviour change. The project has its own \`node:test\` suite that only imports the project's code, never the dependency.

**Validation before scoring.** \`benchmarks/validate.mjs\` runs every case in the same sandbox, without any model, and a case is scored only if (1) its suite passes on the old version, (2) the suite fails after the upgrade alone, proving the break is real, and (3) the suite passes again with the reference fix in \`solution/\` applied, proving the case is solvable. Cases that fail any check are excluded.

**The pipeline under test.** \`benchmarks/run.mjs\` loads the compiled worker's own \`DockerSandboxService\` and configuration and runs each case through the same phases and order as a real job: \`install\` (lifecycle scripts, no token), a baseline \`test\`, \`upgrade\` to the exact target version, then \`refactor\` and \`test\` alternating up to ${meta.maxAttempts} attempts, with each failing test output passed to the next refactor attempt. Each phase is a fresh container from the production sandbox image with the production limits; test phases have no network. Only \`prepare\` (clone) and \`publish\` (push and pull request) are not run: the checkout is seeded from the case instead.

**Release notes.** The model receives the release notes production would fetch, not a hand-written hint. \`benchmarks/fetch-notes.mjs\` ran production's \`fetchReleaseNotes\` once per case (npm registry, then the GitHub release for the target tag) and stored the result, or production's fallback sentence when nothing was found, in \`benchmarks/notes/\`. Every run reuses these snapshots.

**Isolation and leakage.** Every case gets a new Docker volume containing only \`package.json\`, the lockfile, \`src/\` and \`test/\`. The case description, the reference fix and the validation results never enter the sandbox, and the volume is deleted afterwards, so nothing carries over between cases. The model is stateless between calls. Test files are hashed before and after: a migration that edits a test is a failure even if the suite passes.

**Rate limits.** A rate-limited model call is retried after 2 and then 4 minutes, as BullMQ retries a rate-limited job in production. The waits are excluded from migration time. Production re-runs the whole job on a retry; the benchmark retries only the refactor attempt that was limited, which leads to the same outcome without repeating the earlier phases.

**Metrics.** Success means the project's existing test suite passes after the migration and no test file changed. First-attempt pass means it passed after the first refactor. Migration time runs from the start of \`upgrade\` to the end of the last test run (install and baseline excluded); it includes container start-up and model latency on this host.

## Limitations
${(meta.models ?? []).length > 1 ? `
- **This run mixed ${meta.models.length} models** (${meta.models.map((model) => `\`${model}\``).join(', ')}), because the provider's free tier allows only a few requests per model per day. Each case ran on exactly one model (see "By model" and the \`model\` column in \`results.csv\`), cases were assigned to models in alphabetical order rather than at random, and the overall rates are a blend, not the score of any single model.` : ''}
- The cases are small synthetic projects (one dependency, a few files). Real repositories are larger, have more dependencies and slower suites, so these times and rates do not transfer directly.
- Package selection was made by the benchmark authors and leans on well-known Node libraries with documented breaks; it is not a random sample of real-world upgrades.
- Results are for ${(meta.models ?? []).length > 1 ? `${meta.models.length} hosted models` : `one hosted model (\`${meta.model.model}\`)`}${meta.model.source === 'worker default' ? " at the worker's default settings" : ' (chosen with `LLM_MODEL`, not the worker\'s default model)'}, run on one machine. Model output can differ between runs, and timings depend on the host's hardware and load.
- Dependency installs resolve against the live npm registry, so transitive versions of packages introduced by the upgrade can change over time.
- Release notes are a snapshot taken once; production fetches them per job, and they can change upstream.
- The suite is the only success criterion, as in production. A migration can pass a weak suite without being fully correct; the case suites were written to exercise the changed APIs, but they are not exhaustive.
- \`prepare\` and \`publish\` are not exercised, so clone, push and pull request failures are out of scope.
`;
await fs.writeFile(path.join(outDir, 'report.md'), report);
console.log(`wrote report.md, results.csv and summary.json in ${path.relative(process.cwd(), outDir)}`);
console.log(JSON.stringify(summary, null, 2));
