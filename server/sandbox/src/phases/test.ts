import { run } from '../exec.js';
import { loadConfig } from '../config.js';
import { detectPackageManager, packageManagerEnv, testCommand } from '../package-manager.js';
import { clearValidationFailure, writeTestOutput } from '../state.js';
import type { PhaseResult, StepLog } from '../result.js';

/**
 * Executes repository code, which is why its container is started with no
 * network and no credentials of any kind.
 *
 * With TEST_BASELINE=true it runs once before the upgrade, on the version the
 * repository already had, so a suite that was failing all along is not
 * mistaken for a migration the model got wrong.
 */
export async function test(): Promise<PhaseResult> {
  const config = loadConfig();
  const baseline = process.env.TEST_BASELINE === 'true';
  const steps: StepLog[] = [];

  const pm = await detectPackageManager(config.repoDir);
  const { command, args } = testCommand(pm);
  const result = await run(command, args, {
    cwd: config.repoDir,
    env: packageManagerEnv(config.workspace),
  });

  // The next refactor attempt reads this back to correct itself.
  await writeTestOutput(config.stateDir, result.output);

  const label = baseline
    ? 'Baseline run before the upgrade'
    : `Attempt ${config.llm.attempt}/${config.llm.maxAttempts}`;
  steps.push({
    step: baseline ? 'BASELINE' : 'TEST',
    output: `${label}\n$ ${command} ${args.join(' ')}\n${result.output}`,
    exitCode: result.code,
  });

  if (result.code !== 0) {
    // This attempt never reached validation, so a reason from the previous
    // attempt must not ride along beside the new test failure.
    await clearValidationFailure(config.stateDir);
    return {
      phase: 'test',
      ok: false,
      error: `test suite failed with exit code ${result.code}`,
      steps,
    };
  }

  return { phase: 'test', ok: true, steps };
}
