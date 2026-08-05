import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOrThrow } from './exec.js';

const GIT_USER_NAME = 'SyncLab Bot';
const GIT_USER_EMAIL = 'bot@synclab.local';

/**
 * Writes the token to git's credential store instead of embedding it in the
 * remote URL, which would leave it in .git/config and in every log line that
 * mentions the remote.
 */
export async function configureGitCredentials(token: string, repoUrl: string): Promise<void> {
  const host = new URL(repoUrl).host;
  const credentialsPath = path.join(os.homedir(), '.git-credentials');

  await fs.writeFile(credentialsPath, `https://x-access-token:${token}@${host}\n`, {
    mode: 0o600,
  });

  await runOrThrow('git', ['config', '--global', 'credential.helper', 'store']);
  await runOrThrow('git', ['config', '--global', 'user.name', GIT_USER_NAME]);
  await runOrThrow('git', ['config', '--global', 'user.email', GIT_USER_EMAIL]);
}

export async function currentBranch(repoDir: string): Promise<string> {
  const result = await runOrThrow('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoDir });
  return result.output.trim();
}

export async function hasUncommittedChanges(repoDir: string): Promise<boolean> {
  const result = await runOrThrow('git', ['status', '--porcelain'], { cwd: repoDir });
  return result.output.trim().length > 0;
}
