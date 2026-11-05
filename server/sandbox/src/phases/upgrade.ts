import { loadConfig } from '../config.js';
import { detectPackageManager, packageManagerEnv } from '../package-manager.js';
import { missingDependencyOutcome, packageDeclaresDependency, upgradeDependency } from '../upgrade.js';
import type { PhaseResult } from '../result.js';
import { projectDirectories } from '../project-directories.js';

/**
 * Runs after the baseline test run, so the suite is first proven on the
 * version the repository already had. When it installs a release, that
 * release's scripts run, so this phase gets the network but no GitHub token.
 */
export async function upgrade(): Promise<PhaseResult> {
  const config = loadConfig();
  const { dependency } = config.migration;
  if (!dependency) {
    throw new Error('The upgrade phase needs DEPENDENCY_NAME and TARGET_VERSION');
  }
  const steps: PhaseResult['steps'] = [];
  const minimum = config.migration.kind === 'api_change';
  let upgraded = false;
  for (const directory of await projectDirectories(config)) {
    if (minimum && !(await packageDeclaresDependency(directory, dependency.name))) continue;
    upgraded = true;
    const pm = await detectPackageManager(directory);
    const outcome = await upgradeDependency(
      directory,
      pm,
      dependency.name,
      dependency.version,
      packageManagerEnv(config.workspace),
      { minimum },
    );
    steps.push(outcome.step);
    if (!outcome.ok) {
      return { phase: 'upgrade', ok: false, error: outcome.error, steps };
    }
  }
  if (!upgraded) {
    const outcome = missingDependencyOutcome(dependency.name);
    return { phase: 'upgrade', ok: false, error: outcome.error, steps: [outcome.step] };
  }
  return { phase: 'upgrade', ok: true, steps };
}
