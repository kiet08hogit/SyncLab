import { loadWorkspace } from '../config.js';
import {
  clearTestOutput,
  clearValidationFailure,
  writeValidationFailure,
} from '../state.js';
import { loadChecks, type ValidateCheck } from '../validate/load-checks.js';
import type { PhaseResult } from '../result.js';

/**
 * Proves the migration fixed the API usage, after the repository's own suite
 * has passed. It runs SyncLab's checks and nothing from the repository, which
 * is why its container has no network and no token. With no checks registered
 * it passes, and a failure is saved for the next refactor attempt.
 */
export async function validate(): Promise<PhaseResult> {
  const { stateDir } = loadWorkspace();
  return runValidation(stateDir, await loadChecks());
}

export async function runValidation(
  stateDir: string,
  checks: ValidateCheck[],
): Promise<PhaseResult> {
  const failures: string[] = [];

  for (const check of checks) {
    try {
      const reason = (await check.run())?.trim();
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
