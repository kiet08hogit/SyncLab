import { run } from '../exec.js';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { detectPackageManager, installCommand, packageManagerEnv } from '../package-manager.js';
import type { PhaseResult } from '../result.js';
import { projectDirectories } from '../project-directories.js';

/**
 * Installs the repository's dependencies with their lifecycle scripts. Those
 * scripts are untrusted code, so this phase gets a network connection to reach
 * the registry but no GitHub token.
 */
export async function install(): Promise<PhaseResult> {
  const config = loadConfig();
  const steps: PhaseResult['steps'] = [];
  for (const directory of await projectDirectories(config)) {
    const pm = await detectPackageManager(directory);
    const { command, args } = installCommand(pm);
    const result = await run(command, args, {
      cwd: directory,
      env: packageManagerEnv(config.workspace),
    });
    steps.push({
      step: 'INSTALL',
      output: `$ ${command} ${args.join(' ')}${directory === config.repoDir ? '' : ` (${path.relative(config.repoDir, directory)})`}\n${result.output}`,
      exitCode: result.code,
    });
    if (result.code !== 0) {
      return { phase: 'install', ok: false, error: 'dependency install failed', steps };
    }
  }

  return { phase: 'install', ok: true, steps };
}
