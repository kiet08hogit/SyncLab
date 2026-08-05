import path from 'node:path';

export interface SandboxConfig {
  workspace: string;
  repoDir: string;
  repoUrl: string;
  repoFullName: string;
  dependencyName: string;
  targetVersion: string;
  branchName: string;
  codemodSearch: string;
  codemodReplace: string;
  githubApiUrl: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function loadConfig(): SandboxConfig {
  const workspace = process.env.SANDBOX_WORKSPACE ?? '/workspace';

  return {
    workspace,
    repoDir: path.join(workspace, 'repo'),
    repoUrl: required('REPO_URL'),
    repoFullName: required('REPO_FULL_NAME'),
    dependencyName: required('DEPENDENCY_NAME'),
    targetVersion: required('TARGET_VERSION'),
    branchName: required('BRANCH_NAME'),
    codemodSearch: required('CODEMOD_SEARCH'),
    codemodReplace: process.env.CODEMOD_REPLACE ?? '',
    githubApiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
  };
}

/**
 * Only the prepare and publish phases receive a token. The migrate phase runs
 * untrusted repository code, so its container is started without one.
 */
export function requireToken(): string {
  return required('GITHUB_TOKEN');
}
