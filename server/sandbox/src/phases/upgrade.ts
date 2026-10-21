import { loadConfig } from '../config.js';
import { detectPackageManager, packageManagerEnv } from '../package-manager.js';
import { upgradeDependency } from '../upgrade.js';
import type { PhaseResult } from '../result.js';

/**
 * Runs after the baseline test run, so the suite is first proven on the
 * version the repository already had. Like install, it runs the new release's
 * install scripts and so gets the network but no GitHub token.
 */
export async function upgrade(): Promise<PhaseResult> {
  const config = loadConfig();
  const { dependency } = config.migration;
  if (!dependency) {
    throw new Error('The upgrade phase needs DEPENDENCY_NAME and TARGET_VERSION');
  }
  const pm = await detectPackageManager(config.repoDir);

  const outcome = await upgradeDependency(
    config.repoDir,
    pm,
    dependency.name,
    dependency.version,
    packageManagerEnv(config.workspace),
  );

  if (!outcome.ok) {
    return { phase: 'upgrade', ok: false, error: outcome.error, steps: [outcome.step] };
  }

  return { phase: 'upgrade', ok: true, steps: [outcome.step] };
}
