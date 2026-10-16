import { run } from '../exec.js';
import { loadConfig } from '../config.js';
import { detectPackageManager, installCommand, packageManagerEnv } from '../package-manager.js';
import type { PhaseResult } from '../result.js';

/**
 * Installs the repository's dependencies with their lifecycle scripts. Those
 * scripts are untrusted code, so this phase gets a network connection to reach
 * the registry but no GitHub token.
 */
export async function install(): Promise<PhaseResult> {
  const config = loadConfig();
  const pm = await detectPackageManager(config.repoDir);
  const { command, args } = installCommand(pm);

  const result = await run(command, args, {
    cwd: config.repoDir,
    env: packageManagerEnv(config.workspace),
  });

  const steps = [
    {
      step: 'INSTALL',
      output: `$ ${command} ${args.join(' ')}\n${result.output}`,
      exitCode: result.code,
    },
  ];

  if (result.code !== 0) {
    return { phase: 'install', ok: false, error: 'dependency install failed', steps };
  }

  return { phase: 'install', ok: true, steps };
}
