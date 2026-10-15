import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeDependencyUsage } from '../server/sandbox/dist/analysis/imports.js';
import { collectSourceFiles } from '../server/sandbox/dist/files.js';
import { refactor } from '../server/sandbox/dist/phases/refactor.js';
import { test as runTests } from '../server/sandbox/dist/phases/test.js';
import { writeBreakingChanges } from '../server/sandbox/dist/state.js';
import { normalizeVersion, upgradeDependency } from '../server/sandbox/dist/upgrade.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = path.join(root, 'benchmarks', 'cases');
const resultsDir = path.join(root, 'benchmarks', 'results');
const MAX_ATTEMPTS = 3;

function loadEnvFile(filePath) {
  return fs.readFile(filePath, 'utf8').then((text) => {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
        continue;
      }
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index);
      const value = trimmed.slice(index + 1).replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, output }));
  });
}

async function copyCase(source, destination) {
  await fs.cp(source, destination, {
    recursive: true,
    filter: (entry) => path.basename(entry) !== 'node_modules' && path.basename(entry) !== 'case.json',
  });
}

async function selectedFiles(repoDir, dependencyName) {
  const files = await collectSourceFiles(repoDir);
  const selected = [];
  for (const absolutePath of files) {
    const contents = await fs.readFile(absolutePath, 'utf8');
    if (analyzeDependencyUsage(contents, dependencyName)) {
      selected.push(path.relative(repoDir, absolutePath));
    }
  }
  return selected.sort();
}

async function isUpgradeApplied(repoDir, spec) {
  const version = normalizeVersion(spec.targetVersion);
  const manifest = JSON.parse(await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'));
  const installed = JSON.parse(
    await fs.readFile(path.join(repoDir, 'node_modules', spec.dependency, 'package.json'), 'utf8'),
  );
  const declared = { ...manifest.devDependencies, ...manifest.dependencies }[spec.dependency] ?? '';
  return declared.replace(/^[\^~]/, '') === version && installed.version === version;
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function containsPattern(repoDir, relativePath, pattern) {
  const contents = await fs.readFile(path.join(repoDir, relativePath), 'utf8');
  return contents.includes(pattern);
}

async function runCase(caseDir) {
  const spec = JSON.parse(await fs.readFile(path.join(caseDir, 'case.json'), 'utf8'));
  const started = Date.now();
  const workspace = path.join(resultsDir, 'workspaces', spec.id);
  const repoDir = path.join(workspace, 'repo');
  const stateDir = path.join(workspace, 'state');
  await fs.rm(workspace, { recursive: true, force: true });
  await copyCase(caseDir, repoDir);
  await writeBreakingChanges(stateDir, spec.breakingChanges);

  const installStarted = Date.now();
  const install = await runCommand('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], repoDir);
  const installMs = Date.now() - installStarted;
  if (install.code !== 0) {
    return failureRecord(spec, started, installMs, {
      failureCategory: 'setup_failed',
      failureReason: `npm install failed: ${install.output.slice(-500)}`,
      selectedFiles: [],
      astCorrect: false,
    });
  }

  // Cases marked upgrade start on the old version, so they exercise the same
  // upgrade step the prepare phase runs before the refactor.
  if (spec.upgrade) {
    const upgrade = await upgradeDependency(repoDir, spec.dependency, spec.targetVersion);
    if (!upgrade.ok) {
      return failureRecord(spec, started, installMs, {
        failureCategory: 'setup_failed',
        failureReason: `${upgrade.error}: ${upgrade.step.output.slice(-500)}`,
        selectedFiles: [],
        astCorrect: false,
      });
    }
  }
  const upgradeApplied = spec.upgrade ? await isUpgradeApplied(repoDir, spec) : true;

  const baseline = await runCommand('npm', ['test'], repoDir);
  const selected = await selectedFiles(repoDir, spec.dependency);
  const expected = [...spec.expectedFiles].sort();
  const astCorrect = sameSet(selected, expected);

  applyEnv(repoDir, stateDir, spec);

  const attempts = [];
  let finalBuild = { ok: false, output: '' };
  let finalTest = { ok: false, output: '' };
  let changedFiles = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    process.env.REFACTOR_ATTEMPT = String(attempt);
    const attemptStarted = Date.now();
    const refactored = await refactor();
    const changed = Array.isArray(refactored.data?.changedFiles) ? refactored.data.changedFiles : [];
    changedFiles = [...new Set([...changedFiles, ...changed])];

    if (!refactored.ok) {
      attempts.push({
        attempt,
        refactorOk: false,
        retryable: refactored.data?.retryable === true,
        error: refactored.error ?? 'refactor failed',
        durationMs: Date.now() - attemptStarted,
      });
      if (refactored.data?.retryable !== true) {
        break;
      }
      continue;
    }

    const build = await runCommand('npm', ['run', 'build'], repoDir);
    const tested = await runTests();
    finalBuild = { ok: build.code === 0, output: build.output };
    finalTest = { ok: tested.ok, output: tested.steps.map((step) => step.output).join('\n') };
    if (!finalBuild.ok) {
      const { writeTestOutput } = await import('../server/sandbox/dist/state.js');
      await writeTestOutput(stateDir, `Build failed:\n${build.output}\n\n${finalTest.output}`);
    }

    attempts.push({
      attempt,
      refactorOk: true,
      changedFiles: changed,
      buildOk: finalBuild.ok,
      testsOk: finalTest.ok,
      durationMs: Date.now() - attemptStarted,
    });

    if (finalBuild.ok && finalTest.ok) {
      break;
    }
  }

  const patternsRemaining = [];
  for (const relativePath of spec.filesThatMustChange) {
    for (const pattern of spec.removedPatterns) {
      if (await containsPattern(repoDir, relativePath, pattern)) {
        patternsRemaining.push(`${relativePath}: ${pattern}`);
      }
    }
  }

  const requiredChangesMade = spec.filesThatMustChange.every((file) => changedFiles.includes(file));
  const first = attempts[0];
  const firstAttemptSuccess = Boolean(
    first && first.buildOk && first.testsOk && patternsRemaining.length === 0 && requiredChangesMade && astCorrect,
  );
  const buildPassed = finalBuild.ok;
  const testsPassed = finalTest.ok;
  const success =
    upgradeApplied &&
    astCorrect &&
    requiredChangesMade &&
    patternsRemaining.length === 0 &&
    buildPassed &&
    testsPassed &&
    attempts.length > 0 &&
    attempts.length <= MAX_ATTEMPTS;

  let failureCategory = null;
  let failureReason = null;
  if (!success) {
    if (!upgradeApplied) {
      failureCategory = 'upgrade_not_applied';
      failureReason = `package.json or node_modules is not at ${spec.dependency}@${spec.targetVersion}`;
    } else if (!astCorrect) {
      failureCategory = 'ast_mismatch';
      failureReason = `selected [${selected.join(', ')}], expected [${expected.join(', ')}]`;
    } else if (attempts.some((attempt) => attempt.retryable)) {
      failureCategory = 'rate_limit';
      failureReason = attempts.find((attempt) => attempt.error)?.error ?? 'model rate limited';
    } else if (attempts.some((attempt) => attempt.refactorOk === false)) {
      failureCategory = 'model_error';
      failureReason = attempts.find((attempt) => attempt.error)?.error ?? 'model call failed';
    } else if (!requiredChangesMade || patternsRemaining.length > 0) {
      failureCategory = 'incomplete_migration';
      failureReason = patternsRemaining.join('; ') || `changed [${changedFiles.join(', ')}]`;
    } else if (!buildPassed) {
      failureCategory = 'build_failed';
      failureReason = finalBuild.output.slice(-500);
    } else if (!testsPassed) {
      failureCategory = 'tests_failed';
      failureReason = finalTest.output.slice(-500);
    } else {
      failureCategory = 'unknown';
      failureReason = 'success criteria were not all met';
    }
  }

  return {
    id: spec.id,
    difficulty: spec.difficulty,
    dependency: spec.dependency,
    targetVersion: spec.targetVersion,
    summary: spec.summary,
    filesAffected: spec.filesThatMustChange.length,
    expectedFiles: expected,
    selectedFiles: selected,
    astCorrect,
    upgradeApplied,
    changedFiles,
    requiredChangesMade,
    patternsRemaining,
    firstAttemptPassed: firstAttemptSuccess,
    attemptsUsed: attempts.length,
    attempts,
    buildPassed,
    testsPassed,
    baselineTestsFailed: baseline.code !== 0,
    success,
    failureCategory,
    failureReason,
    installMs,
    executionMs: Date.now() - started - installMs,
    totalMs: Date.now() - started,
  };
}

function failureRecord(spec, started, installMs, extra) {
  return {
    id: spec.id,
    difficulty: spec.difficulty,
    dependency: spec.dependency,
    targetVersion: spec.targetVersion,
    summary: spec.summary,
    filesAffected: spec.filesThatMustChange.length,
    expectedFiles: [...spec.expectedFiles].sort(),
    changedFiles: [],
    requiredChangesMade: false,
    patternsRemaining: [],
    firstAttemptPassed: false,
    attemptsUsed: 0,
    attempts: [],
    buildPassed: false,
    testsPassed: false,
    baselineTestsFailed: false,
    success: false,
    installMs,
    executionMs: Date.now() - started - installMs,
    totalMs: Date.now() - started,
    ...extra,
  };
}

function applyEnv(repoDir, stateDir, spec) {
  process.env.SANDBOX_WORKSPACE = path.dirname(repoDir);
  process.env.REPO_URL = 'https://example.invalid/synclab/benchmark.git';
  process.env.REPO_FULL_NAME = `synclab/${spec.id}`;
  process.env.DEPENDENCY_NAME = spec.dependency;
  process.env.TARGET_VERSION = spec.targetVersion;
  process.env.BRANCH_NAME = `synclab/${spec.id}`;
  process.env.REFACTOR_MAX_ATTEMPTS = String(MAX_ATTEMPTS);
  process.env.LLM_MAX_FILES = process.env.LLM_MAX_FILES || '20';
  process.env.LLM_MAX_FILE_BYTES = process.env.LLM_MAX_FILE_BYTES || '60000';
  if (!process.env.LLM_MODEL) {
    process.env.LLM_MODEL = DEFAULT_MODELS[process.env.LLM_PROVIDER];
  }
  // The benchmark runs on the host, not in a sandbox container, so Ollama is
  // on localhost rather than host.docker.internal.
  process.env.LLM_BASE_URL = 'http://localhost:11434';
  void stateDir;
}

function percent(part, total) {
  if (total === 0) {
    return 'n/a';
  }
  return `${((part / total) * 100).toFixed(1)}% (${part}/${total})`;
}

function report(results, meta) {
  const total = results.length;
  const successes = results.filter((result) => result.success);
  const first = results.filter((result) => result.firstAttemptPassed);
  const ast = results.filter((result) => result.astCorrect);
  const averageAttempts =
    successes.length === 0
      ? 'n/a'
      : (successes.reduce((sum, result) => sum + result.attemptsUsed, 0) / successes.length).toFixed(2);
  const categories = {};
  for (const result of results) {
    if (!result.success) {
      categories[result.failureCategory ?? 'unknown'] = (categories[result.failureCategory ?? 'unknown'] ?? 0) + 1;
    }
  }

  const lines = [
    '# SyncLab local migration benchmark',
    '',
    'Synthetic local fixtures. This is not a production or live-webhook result.',
    'The runner calls the sandbox `refactor` and `test` phases. It does not receive a GitHub webhook, clone a repository, or open a pull request.',
    'A case counts as successful only when AST targeting matches, every file that must change was rewritten, removed APIs are gone, `npm run build` passes, and `npm test` passes within 3 attempts.',
    '',
    `- Started: ${meta.startedAt}`,
    `- Model: ${meta.provider}/${meta.model}`,
    `- Max attempts: ${MAX_ATTEMPTS}`,
    '',
    '## Summary',
    '',
    `- Total cases: ${total}`,
    `- First-attempt success rate: ${percent(first.length, total)}`,
    `- Final success rate within 3 attempts: ${percent(successes.length, total)}`,
    `- Average attempts for successful migrations: ${averageAttempts}`,
    `- AST targeting accuracy: ${percent(ast.length, total)}`,
    `- Failures: ${total - successes.length}`,
    '',
    '## Failure categories',
    '',
  ];

  if (Object.keys(categories).length === 0) {
    lines.push('None.');
  } else {
    for (const [category, count] of Object.entries(categories)) {
      lines.push(`- ${category}: ${count}`);
    }
  }

  lines.push('', '## Cases', '');
  for (const result of results) {
    lines.push(`### ${result.id} (${result.difficulty})`);
    lines.push('');
    lines.push(`- Dependency: ${result.dependency}@${result.targetVersion}`);
    lines.push(`- Files that must change: ${result.filesAffected}`);
    lines.push(`- AST selected: ${result.selectedFiles.join(', ') || '(none)'}`);
    lines.push(`- AST correct: ${result.astCorrect}`);
    lines.push(`- First attempt passed: ${result.firstAttemptPassed}`);
    lines.push(`- Attempts used: ${result.attemptsUsed}`);
    lines.push(`- Build passed: ${result.buildPassed}`);
    lines.push(`- Tests passed: ${result.testsPassed}`);
    lines.push(`- Success: ${result.success}`);
    lines.push(`- Execution time excluding install: ${(result.executionMs / 1000).toFixed(1)}s`);
    if (!result.success) {
      lines.push(`- Failure category: ${result.failureCategory}`);
      lines.push(`- Failure reason: ${result.failureReason}`);
    }
    lines.push('');
  }

  lines.push('## Rerun', '');
  lines.push('```bash');
  lines.push('cd server/sandbox && npm run build');
  lines.push('cd ../.. && node benchmarks/run.mjs');
  lines.push('```');
  lines.push('');
  lines.push(
    'Uses `LLM_PROVIDER` (default `ollama`, with Ollama running on localhost). With `gemini`, requires `GEMINI_API_KEY` in the environment or in `server/api/.env`.',
  );
  lines.push('');
  return lines.join('\n');
}

const startedAt = new Date().toISOString();
await loadEnvFile(path.join(root, 'server', 'api', '.env')).catch(() => undefined);
const DEFAULT_MODELS = { ollama: 'qwen2.5-coder:14b', gemini: 'gemini-3.1-pro-preview' };
if (!process.env.LLM_PROVIDER) {
  process.env.LLM_PROVIDER = 'ollama';
}
if (!Object.hasOwn(DEFAULT_MODELS, process.env.LLM_PROVIDER)) {
  throw new Error(
    `LLM_PROVIDER must be one of ${Object.keys(DEFAULT_MODELS).join(', ')}, got "${process.env.LLM_PROVIDER}".`,
  );
}
if (process.env.LLM_PROVIDER === 'gemini' && !process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set. Refusing to invent benchmark results.');
}

const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').filter(Boolean)) : null;
const outFile = outArg ? outArg.slice('--out='.length) : 'results.json';

const entries = (await fs.readdir(casesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => !only || only.has(name))
  .sort();

const results = [];
for (const name of entries) {
  process.stdout.write(`running ${name}\n`);
  results.push(await runCase(path.join(casesDir, name)));
  process.stdout.write(`finished ${name}: success=${results.at(-1).success}\n`);
}

await fs.mkdir(resultsDir, { recursive: true });
const payload = {
  kind: 'local-synthetic',
  startedAt,
  finishedAt: new Date().toISOString(),
  provider: process.env.LLM_PROVIDER,
  model: process.env.LLM_MODEL,
  maxAttempts: MAX_ATTEMPTS,
  results,
};
await fs.writeFile(path.join(resultsDir, outFile), `${JSON.stringify(payload, null, 2)}\n`);
if (outFile === 'results.json') {
  await fs.writeFile(path.join(resultsDir, 'report.md'), report(results, payload));
}
process.stdout.write(`wrote benchmarks/results/${outFile}\n`);
