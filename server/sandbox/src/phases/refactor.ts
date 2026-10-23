import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfig, type SandboxConfig } from '../config.js';
import { collectSourceFiles } from '../files.js';
import { analyzeDependencyUsage, type DependencyUsage } from '../analysis/imports.js';
import { readBreakingChanges, readTestOutput } from '../state.js';
import { createRefactorChain } from '../llm/refactor-chain.js';
import { isRetryableModelError } from '../llm/errors.js';
import type { PhaseResult, StepLog } from '../result.js';

interface Candidate {
  absolutePath: string;
  relativePath: string;
  contents: string;
  usage: DependencyUsage;
}

interface Selection {
  candidates: Candidate[];
  skipped: string[];
}

const NO_USAGE: DependencyUsage = { importedNames: [], usageLines: [] };

/**
 * Only a regular file reached without leaving the checkout: repository code
 * has had the tree since install and could have planted a link to anywhere.
 */
async function resolveImpactedFile(repoDir: string, relativePath: string): Promise<string | undefined> {
  const absolutePath = path.join(repoDir, relativePath);
  const stat = await fs.lstat(absolutePath).catch(() => undefined);
  if (!stat?.isFile()) {
    return undefined;
  }

  const real = await fs.realpath(absolutePath);
  return real === path.join(await fs.realpath(repoDir), relativePath) ? absolutePath : undefined;
}

/**
 * Keeps whole repositories out of the prompt. A dependency migration sends
 * only files the AST scan finds importing it, each with its call sites
 * already identified; an API change sends the files its impact recorded.
 */
async function selectCandidates(config: SandboxConfig): Promise<Selection> {
  const candidates: Candidate[] = [];
  const skipped: string[] = [];

  function consider(absolutePath: string, contents: string, usage: DependencyUsage): void {
    const relativePath = path.relative(config.repoDir, absolutePath);

    if (Buffer.byteLength(contents, 'utf8') > config.llm.maxFileBytes) {
      skipped.push(`${relativePath} (over the ${config.llm.maxFileBytes} byte limit)`);
      return;
    }

    candidates.push({ absolutePath, relativePath, contents, usage });
  }

  const { migration } = config;
  if (migration.kind === 'dependency') {
    for (const absolutePath of await collectSourceFiles(config.repoDir)) {
      const contents = await fs.readFile(absolutePath, 'utf8');
      const usage = analyzeDependencyUsage(contents, migration.dependency.name);
      if (usage) {
        consider(absolutePath, contents, usage);
      }
    }
  } else {
    for (const file of migration.files) {
      const absolutePath = await resolveImpactedFile(config.repoDir, file);
      if (!absolutePath) {
        skipped.push(`${file} (not a regular file inside the repository)`);
        continue;
      }
      consider(absolutePath, await fs.readFile(absolutePath, 'utf8'), NO_USAGE);
    }
  }

  if (candidates.length <= config.llm.maxFiles) {
    return { candidates, skipped };
  }

  for (const candidate of candidates.slice(config.llm.maxFiles)) {
    skipped.push(`${candidate.relativePath} (over the ${config.llm.maxFiles} file limit)`);
  }

  return { candidates: candidates.slice(0, config.llm.maxFiles), skipped };
}

export async function refactor(): Promise<PhaseResult> {
  const config = loadConfig();
  const steps: StepLog[] = [];

  const breakingChanges = await readBreakingChanges(config.stateDir);
  // Only a retry has something to learn from.
  const previousTestOutput =
    config.llm.attempt > 1 ? await readTestOutput(config.stateDir) : undefined;

  const { candidates, skipped } = await selectCandidates(config);

  if (candidates.length === 0) {
    const reason =
      config.migration.kind === 'dependency'
        ? `No source file imports "${config.migration.dependency.name}"`
        : 'None of the impacted files could be sent';
    steps.push({
      step: 'REFACTOR',
      output: [
        `${reason}, so nothing was sent to the model.`,
        ...skipped.map((entry) => `Skipped ${entry}`),
      ].join('\n'),
    });
    return { phase: 'refactor', ok: true, steps, data: { changedFiles: [] } };
  }

  const refactorFile = createRefactorChain(config);
  const changedFiles: string[] = [];
  const notes: string[] = [];

  for (const candidate of candidates) {
    let result;

    try {
      result = await refactorFile({
        relativePath: candidate.relativePath,
        contents: candidate.contents,
        usage: candidate.usage,
        breakingChanges,
        previousTestOutput,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({ step: 'REFACTOR', output: [...notes, message].join('\n') });

      return {
        phase: 'refactor',
        ok: false,
        error: `model call failed on ${candidate.relativePath}: ${message}`,
        steps,
        // The worker turns this into a delayed BullMQ retry rather than a
        // permanent failure.
        data: { retryable: isRetryableModelError(error) },
      };
    }

    if (!result.changed || result.contents === candidate.contents) {
      notes.push(`${candidate.relativePath}: left alone - ${result.reason}`);
      continue;
    }

    await fs.writeFile(candidate.absolutePath, result.contents, 'utf8');
    changedFiles.push(candidate.relativePath);
    notes.push(`${candidate.relativePath}: ${result.reason}`);
  }

  steps.push({
    step: 'REFACTOR',
    output: [
      `Attempt ${config.llm.attempt}/${config.llm.maxAttempts} using ${config.llm.model}`,
      `Rewrote ${changedFiles.length} of ${candidates.length} candidate file(s).`,
      ...notes,
      ...skipped.map((entry) => `Skipped ${entry}`),
    ].join('\n'),
  });

  return { phase: 'refactor', ok: true, steps, data: { changedFiles } };
}
