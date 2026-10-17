import path from 'node:path';

export const LLM_PROVIDERS = ['ollama', 'gemini', 'anthropic'] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  /** Only read by the Ollama provider. */
  baseUrl: string;
  /** Only read by the Ollama provider. */
  numCtx: number;
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

export function resolveLlmProvider(value: string | undefined): LlmProvider {
  if (!value) {
    return 'ollama';
  }

  if (!LLM_PROVIDERS.includes(value as LlmProvider)) {
    throw new Error(`LLM_PROVIDER must be one of ${LLM_PROVIDERS.join(', ')}, got "${value}".`);
  }

  return value as LlmProvider;
}

/** Where the shared volume holds the clone and the state passed between phases. */
export function loadWorkspace(): Pick<SandboxConfig, 'workspace' | 'repoDir' | 'stateDir'> {
  const workspace = process.env.SANDBOX_WORKSPACE ?? '/workspace';

  return {
    workspace,
    repoDir: path.join(workspace, 'repo'),
    stateDir: path.join(workspace, 'state'),
  };
}

export function loadConfig(): SandboxConfig {
  return {
    ...loadWorkspace(),
    repoUrl: required('REPO_URL'),
    repoFullName: required('REPO_FULL_NAME'),
    dependencyName: required('DEPENDENCY_NAME'),
    targetVersion: required('TARGET_VERSION'),
    branchName: required('BRANCH_NAME'),
    githubApiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    llm: {
      provider: resolveLlmProvider(process.env.LLM_PROVIDER),
      model: required('LLM_MODEL'),
      baseUrl: process.env.LLM_BASE_URL ?? 'http://host.docker.internal:11434',
      numCtx: positiveNumber(process.env.LLM_NUM_CTX, 32_768),
      attempt: positiveNumber(process.env.REFACTOR_ATTEMPT, 1),
      maxAttempts: positiveNumber(process.env.REFACTOR_MAX_ATTEMPTS, 1),
      maxFiles: positiveNumber(process.env.LLM_MAX_FILES, 20),
      maxFileBytes: positiveNumber(process.env.LLM_MAX_FILE_BYTES, 60_000),
    },
  };
}

/** The clone phase only needs to know what to clone, not the rest of the job. */
export function requireRepoUrl(): string {
  return required('REPO_URL');
}

/**
 * Only the prepare, clone and publish phases receive a token. The test phase runs
 * untrusted repository code, so its container is started without one, and the
 * refactor phase has no reason to reach GitHub.
 */
export function requireToken(): string {
  return required('GITHUB_TOKEN');
}

/**
 * Only the refactor phase talks to the model provider, and only a hosted
 * provider needs a key.
 */
export function requireGeminiKey(): string {
  return required('GEMINI_API_KEY');
}

export function requireAnthropicKey(): string {
  return required('ANTHROPIC_API_KEY');
}
