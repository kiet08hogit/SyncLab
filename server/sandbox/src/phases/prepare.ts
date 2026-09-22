import { promises as fs } from 'node:fs';
import { Octokit } from '@octokit/rest';
import { run, redact, runOrThrow } from '../exec.js';
import { configureGitCredentials } from '../git.js';
import { loadConfig, requireToken } from '../config.js';
import { fetchReleaseNotes } from '../changelog.js';
import { writeBreakingChanges } from '../state.js';
import type { PhaseResult, StepLog } from '../result.js';

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.length === 0;
  } catch {
    return true;
  }
}

export async function prepare(): Promise<PhaseResult> {
  const config = loadConfig();
  const token = requireToken();
  const steps: StepLog[] = [];

  await configureGitCredentials(token, config.repoUrl);

  if (!(await isEmptyDir(config.repoDir))) {
    await fs.rm(config.repoDir, { recursive: true, force: true });
  }

  // Deliberately not a shallow clone: GitHub rejects pushes from some shallow
  // checkouts with "shallow update not allowed".
  const clone = await run('git', ['clone', config.repoUrl, config.repoDir]);
  steps.push({
    step: 'CLONE',
    output: redact(clone.output, [token]),
    exitCode: clone.code,
  });

  if (clone.code !== 0) {
    return { phase: 'prepare', ok: false, error: 'git clone failed', steps };
  }

  // The lockfile decides which install command is valid; npm ci refuses to run without one.
  const hasLockfile = await fs
    .access(`${config.repoDir}/package-lock.json`)
    .then(() => true)
    .catch(() => false);

  const install = await run('npm', [hasLockfile ? 'ci' : 'install'], { cwd: config.repoDir });
  steps.push({
    step: 'INSTALL',
    output: redact(install.output, [token]),
    exitCode: install.code,
  });

  if (install.code !== 0) {
    return { phase: 'prepare', ok: false, error: 'dependency install failed', steps };
  }

  // Fetched here because this is the last phase that has both a GitHub token
  // and a network connection. The refactor phase only reads the result.
  const octokit = new Octokit({ auth: token, baseUrl: config.githubApiUrl });
  const notes = await fetchReleaseNotes(
    octokit,
    config.dependencyName,
    config.targetVersion,
  ).catch(() => undefined);

  await writeBreakingChanges(
    config.stateDir,
    notes ??
      `No release notes were found for ${config.dependencyName} ${config.targetVersion}.`,
  );

  steps.push({
    step: 'CHANGELOG',
    output: notes
      ? `Found release notes for ${config.dependencyName} ${config.targetVersion} (${notes.length} characters).`
      : `No release notes found for ${config.dependencyName} ${config.targetVersion}; continuing without them.`,
  });

  const head = await runOrThrow('git', ['rev-parse', 'HEAD'], { cwd: config.repoDir });

  return {
    phase: 'prepare',
    ok: true,
    steps,
    data: { headSha: head.output.trim() },
  };
}
