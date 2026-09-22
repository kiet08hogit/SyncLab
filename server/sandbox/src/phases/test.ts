import { run } from '../exec.js';
import { loadConfig } from '../config.js';
import { writeTestOutput } from '../state.js';
import type { PhaseResult, StepLog } from '../result.js';

/**
 * The only phase that executes repository code, which is why its container is
 * started with no network and no credentials of any kind.
 */
export async function test(): Promise<PhaseResult> {
  const config = loadConfig();
  const steps: StepLog[] = [];

  const result = await run('npm', ['test'], { cwd: config.repoDir });

  // The next refactor attempt reads this back to correct itself.
  await writeTestOutput(config.stateDir, result.output);

  steps.push({
    step: 'TEST',
    output: `Attempt ${config.llm.attempt}/${config.llm.maxAttempts}\n${result.output}`,
    exitCode: result.code,
  });

  if (result.code !== 0) {
    return {
      phase: 'test',
      ok: false,
      error: `test suite failed with exit code ${result.code}`,
      steps,
    };
  }

  return { phase: 'test', ok: true, steps };
}
