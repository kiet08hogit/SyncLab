import type { ContainerCreateOptions } from 'dockerode';
import type { SandboxJobParams, SandboxPhase } from './sandbox.types';

export const WORKSPACE_MOUNT = '/workspace';

export interface SandboxLimits {
  memoryBytes: number;
  nanoCpus: number;
  pidsLimit: number;
}

export interface ContainerOptionsInput {
  phase: SandboxPhase;
  image: string;
  volumeName: string;
  env: Record<string, string>;
  limits: SandboxLimits;
}

/**
 * The test phase is the one that executes untrusted repository code, so it is
 * the one that gets cut off. Clone, install, and pull request creation all
 * legitimately need to reach GitHub, and the refactor phase needs to reach the
 * model provider - but refactor only reads and writes files with our own code,
 * so nothing from the repository ever runs with a network connection.
 */
export function phaseNeedsNetwork(phase: SandboxPhase): boolean {
  return phase !== 'test';
}

/**
 * Kept separate from network access on purpose: these are independent reasons
 * to withhold something from a phase. Refactor has no business reaching GitHub.
 */
export function phaseNeedsToken(phase: SandboxPhase): boolean {
  return phase === 'prepare' || phase === 'publish';
}

export function phaseNeedsLlmKey(phase: SandboxPhase): boolean {
  return phase === 'refactor';
}

export function buildPhaseEnv(
  phase: SandboxPhase,
  params: SandboxJobParams,
  attempt: number,
): Record<string, string> {
  const env: Record<string, string> = {
    REPO_URL: params.repoUrl,
    REPO_FULL_NAME: params.repoFullName,
    DEPENDENCY_NAME: params.dependencyName,
    TARGET_VERSION: params.targetVersion,
    BRANCH_NAME: params.branchName,
    SANDBOX_WORKSPACE: WORKSPACE_MOUNT,
    LLM_MODEL: params.llm.model,
    LLM_MAX_FILES: String(params.llm.maxFiles),
    LLM_MAX_FILE_BYTES: String(params.llm.maxFileBytes),
    REFACTOR_ATTEMPT: String(attempt),
    REFACTOR_MAX_ATTEMPTS: String(params.llm.maxAttempts),
  };

  if (phaseNeedsToken(phase)) {
    env.GITHUB_TOKEN = params.token;
  }

  if (phaseNeedsLlmKey(phase)) {
    env.GEMINI_API_KEY = params.llm.apiKey;
  }

  return env;
}

export function buildContainerOptions(input: ContainerOptionsInput): ContainerCreateOptions {
  const { phase, image, volumeName, env, limits } = input;

  return {
    Image: image,
    Cmd: [phase],
    Tty: false,
    User: 'node',
    WorkingDir: WORKSPACE_MOUNT,
    Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
    Labels: {
      'com.synclab.sandbox': 'true',
      'com.synclab.phase': phase,
    },
    HostConfig: {
      // A named volume, never a host bind: the container gets no view of the host filesystem.
      Binds: [`${volumeName}:${WORKSPACE_MOUNT}`],
      // Equal Memory and MemorySwap disables swap, so the limit is a hard ceiling.
      Memory: limits.memoryBytes,
      MemorySwap: limits.memoryBytes,
      NanoCpus: limits.nanoCpus,
      PidsLimit: limits.pidsLimit,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      NetworkMode: phaseNeedsNetwork(phase) ? 'bridge' : 'none',
      AutoRemove: false,
    },
  };
}
