import { run } from '../exec.js';
import { applyCodemod } from '../codemod.js';
import { loadConfig } from '../config.js';
import type { PhaseResult, StepLog } from '../result.js';

export async function migrate(): Promise<PhaseResult> {
  const config = loadConfig();
  const steps: StepLog[] = [];

  const codemod = await applyCodemod(config.repoDir, config.codemodSearch, config.codemodReplace);
  const summary =
    codemod.replacements === 0
      ? `No occurrences of "${config.codemodSearch}" found.`
      : `Replaced ${codemod.replacements} occurrence(s) of "${config.codemodSearch}" with "${config.codemodReplace}" across ${codemod.changedFiles.length} file(s):\n${codemod.changedFiles.join('\n')}`;

  steps.push({ step: 'MIGRATE', output: summary });

  const test = await run('npm', ['test'], { cwd: config.repoDir });
  steps.push({ step: 'TEST', output: test.output, exitCode: test.code });

  if (test.code !== 0) {
    return {
      phase: 'migrate',
      ok: false,
      error: `test suite failed with exit code ${test.code}`,
      steps,
      data: { changedFiles: codemod.changedFiles, replacements: codemod.replacements },
    };
  }

  return {
    phase: 'migrate',
    ok: true,
    steps,
    data: { changedFiles: codemod.changedFiles, replacements: codemod.replacements },
  };
}
