import path from 'node:path';

export interface LlmConfig {
  model: string;
  attempt: number;
  maxAttempts: number;
  maxFiles: number;
  maxFileBytes: number;
}

export interface SandboxConfig {
  workspace: string;
  repoDir: string;
  stateDir: string;
  repoUrl: string;
  repoFullName: string;
  dependencyName: string;
  targetVersion: string;
  branchName: string;
  githubApiUrl: string;
  llm: LlmConfig;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): SandboxConfig {
  const workspace = process.env.SANDBOX_WORKSPACE ?? '/workspace';

  return {
    workspace,
    repoDir: path.join(workspace, 'repo'),
    stateDir: path.join(workspace, 'state'),
    repoUrl: required('REPO_URL'),
    repoFullName: required('REPO_FULL_NAME'),
    dependencyName: required('DEPENDENCY_NAME'),
    targetVersion: required('TARGET_VERSION'),
    branchName: required('BRANCH_NAME'),
    githubApiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    llm: {
      model: process.env.LLM_MODEL ?? 'gemini-3.1-pro-preview',
      attempt: positiveNumber(process.env.REFACTOR_ATTEMPT, 1),
      maxAttempts: positiveNumber(process.env.REFACTOR_MAX_ATTEMPTS, 1),
      maxFiles: positiveNumber(process.env.LLM_MAX_FILES, 20),
      maxFileBytes: positiveNumber(process.env.LLM_MAX_FILE_BYTES, 60_000),
    },
  };
}

/**
 * Only the prepare and publish phases receive a token. The test phase runs
 * untrusted repository code, so its container is started without one, and the
 * refactor phase has no reason to reach GitHub.
 */
export function requireToken(): string {
  return required('GITHUB_TOKEN');
}

/**
 * Only the refactor phase talks to the model provider.
 */
export function requireLlmKey(): string {
  return required('GEMINI_API_KEY');
}
