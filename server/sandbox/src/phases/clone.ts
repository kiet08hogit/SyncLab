import { promises as fs } from 'node:fs';
import { run, redact, runOrThrow } from '../exec.js';
import { configureGitCredentials } from '../git.js';
import { loadWorkspace, requireRepoUrl, requireToken } from '../config.js';
import type { PhaseResult, StepLog } from '../result.js';

export interface CloneOutcome {
  step: StepLog;
  /** The cloned commit, or undefined when the clone failed. */
  headSha?: string;
}

/**
 * Shared by prepare, which clones for a migration, and clone, which clones for
 * a scan. The token goes to git's credential store in the container's home
 * directory, never onto the shared volume a later phase reads.
 */
export async function cloneRepository(
  repoUrl: string,
  repoDir: string,
  token: string,
  options: { shallow: boolean },
): Promise<CloneOutcome> {
  await configureGitCredentials(token, repoUrl);
  await fs.rm(repoDir, { recursive: true, force: true });

  const args = ['clone', ...(options.shallow ? ['--depth', '1'] : []), repoUrl, repoDir];
  const clone = await run('git', args);
  const step = { step: 'CLONE', output: redact(clone.output, [token]), exitCode: clone.code };

  if (clone.code !== 0) {
    return { step };
  }

  const head = await runOrThrow('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
  return { step, headSha: head.output.trim() };
}

/**
 * Clones the default branch for a scan. Nothing is pushed from this checkout,
 * so a shallow clone is enough and keeps large repositories quick.
 */
export async function clone(): Promise<PhaseResult> {
  const { repoDir } = loadWorkspace();
  const { step, headSha } = await cloneRepository(requireRepoUrl(), repoDir, requireToken(), {
    shallow: true,
  });

  if (!headSha) {
    return { phase: 'clone', ok: false, error: 'git clone failed', steps: [step] };
  }

  return { phase: 'clone', ok: true, steps: [step], data: { headSha } };
}
