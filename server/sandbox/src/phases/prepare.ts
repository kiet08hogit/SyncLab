import { Octokit } from '@octokit/rest';
import { loadConfig, requireToken } from '../config.js';
import { fetchReleaseNotes } from '../changelog.js';
import { writeBreakingChanges } from '../state.js';
import type { PhaseResult, StepLog } from '../result.js';
import { cloneRepository } from './clone.js';

export async function prepare(): Promise<PhaseResult> {
  const config = loadConfig();
  const token = requireToken();
  const steps: StepLog[] = [];

  // Deliberately not a shallow clone: GitHub rejects pushes from some shallow
  // checkouts with "shallow update not allowed".
  const cloned = await cloneRepository(config.repoUrl, config.repoDir, token, { shallow: false });
  steps.push(cloned.step);

  if (!cloned.headSha) {
    return { phase: 'prepare', ok: false, error: 'git clone failed', steps };
  }

  // Dependencies are installed by the install phase, which has no token:
  // install scripts are repository code and must not run beside it.
  // Release notes are fetched here because this is the last phase that has
  // both a GitHub token and a network connection. An API change that keeps
  // its SDK has no release to read; its brief arrives with the job instead.
  const { dependency } = config.migration;
  if (dependency) {
    const octokit = new Octokit({ auth: token, baseUrl: config.githubApiUrl });
    const notes = await fetchReleaseNotes(octokit, dependency.name, dependency.version).catch(
      () => undefined,
    );

    await writeBreakingChanges(
      config.stateDir,
      notes ?? `No release notes were found for ${dependency.name} ${dependency.version}.`,
    );

    steps.push({
      step: 'CHANGELOG',
      output: notes
        ? `Found release notes for ${dependency.name} ${dependency.version} (${notes.length} characters).`
        : `No release notes found for ${dependency.name} ${dependency.version}; continuing without them.`,
    });
  }

  return {
    phase: 'prepare',
    ok: true,
    steps,
    data: { headSha: cloned.headSha },
  };
}
