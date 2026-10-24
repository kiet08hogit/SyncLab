import { createHash } from 'node:crypto';
import { loadWorkspace } from '../config.js';
import {
  clearTestOutput,
  clearValidationFailure,
  readValidateBaseline,
  writeValidateBaseline,
  writeValidationFailure,
} from '../state.js';
import { loadChecks, type ValidateCheck } from '../validate/load-checks.js';
import type { PhaseResult } from '../result.js';

function sha256(contents: string): string {
  return createHash('sha256').update(contents, 'utf8').digest('hex');
}

/**
 * Proves the migration fixed the API usage, after the repository's own suite
 * has passed. It runs SyncLab's checks and nothing from the repository, which
 * is why its container has no network and no token. With no checks registered
 * it passes, and a failure is saved for the next refactor attempt.
 *
 * With VALIDATE_BASELINE=true it runs right after prepare instead, and saves
 * what each check records about the tree as cloned. Repository code can write
 * to the volume from install on, so the worker keeps the digest of that file
 * and every later run trusts the file only when VALIDATE_BASELINE_DIGEST
 * still matches.
 */
export async function validate(): Promise<PhaseResult> {
  const { stateDir } = loadWorkspace();
  const checks = await loadChecks();
  if (process.env.VALIDATE_BASELINE === 'true') {
    return recordBaseline(stateDir, checks);
  }

  const digest = process.env.VALIDATE_BASELINE_DIGEST;
  if (!digest) {
    return runValidation(stateDir, checks);
  }
  const contents = await readValidateBaseline(stateDir);
  if (contents === undefined || sha256(contents) !== digest) {
    return reportFailures(stateDir, [
      'validate: the baseline recorded before the migration is missing or was changed since',
    ]);
  }
  return runValidation(stateDir, checks, JSON.parse(contents) as Record<string, unknown>);
}

export async function recordBaseline(
  stateDir: string,
  checks: ValidateCheck[],
): Promise<PhaseResult> {
  const baselines: Record<string, unknown> = {};
  for (const check of checks) {
    const baseline = await check.baseline?.();
    if (baseline !== undefined) {
      baselines[check.name] = baseline;
    }
  }
  const contents = JSON.stringify(baselines);
  await writeValidateBaseline(stateDir, contents);

  const recorded = Object.keys(baselines);
  const output =
    recorded.length === 0
      ? 'No validation check records a baseline.'
      : `Recorded the baseline of ${recorded.join(', ')} before the migration.`;
  return {
    phase: 'validate',
    ok: true,
    steps: [{ step: 'VALIDATE', output }],
    data: { baselineDigest: sha256(contents) },
  };
}

export async function runValidation(
  stateDir: string,
  checks: ValidateCheck[],
  baselines: Record<string, unknown> = {},
): Promise<PhaseResult> {
  const failures: string[] = [];

  for (const check of checks) {
    try {
      const reason = (await check.run(baselines[check.name]))?.trim();
      if (reason) {
        failures.push(`${check.name}: ${reason}`);
      }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${check.name}: ${reason}`);
    }
  }

  if (failures.length === 0) {
    await clearValidationFailure(stateDir);
    await clearTestOutput(stateDir);
    const output =
      checks.length === 0
        ? 'No validation checks registered.'
        : `${checks.length} validation check(s) passed.`;
    return { phase: 'validate', ok: true, steps: [{ step: 'VALIDATE', output }] };
  }

  return reportFailures(stateDir, failures);
}

async function reportFailures(stateDir: string, failures: string[]): Promise<PhaseResult> {
  const report = failures.join('\n');
  // The suite passed, so its output must not be shown to the model as a failure.
  await clearTestOutput(stateDir);
  await writeValidationFailure(stateDir, report);
  return {
    phase: 'validate',
    ok: false,
    error: report,
    steps: [{ step: 'VALIDATE', output: report }],
  };
}
