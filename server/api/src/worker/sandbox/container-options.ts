import type { ContainerCreateOptions } from 'dockerode';
import { LLM_API_KEY_ENV } from '../../config/configuration';
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
 * The test phase runs the repository's own suite, so it is cut off entirely.
 * Install and upgrade also run untrusted code - dependency lifecycle scripts -
 * but cannot fetch packages without the registry, so they keep the network
 * and instead never receive a token. Refactor needs the model provider and
 * only runs SyncLab's own code.
 */
export function phaseNeedsNetwork(phase: SandboxPhase): boolean {
  return phase !== 'test';
}

/**
 * Kept separate from network access on purpose: these are independent reasons
 * to withhold something from a phase. Only the two phases that run nothing but
 * SyncLab's own code get the token; install scripts and the test suite never
 * run beside it, and refactor has no business reaching GitHub.
 */
export function phaseNeedsToken(phase: SandboxPhase): boolean {
  return phase === 'prepare' || phase === 'publish';
}

export function phaseNeedsModel(phase: SandboxPhase): boolean {
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
    LLM_PROVIDER: params.llm.provider,
    LLM_MODEL: params.llm.model,
    LLM_MAX_FILES: String(params.llm.maxFiles),
    LLM_MAX_FILE_BYTES: String(params.llm.maxFileBytes),
    REFACTOR_ATTEMPT: String(attempt),
    REFACTOR_MAX_ATTEMPTS: String(params.llm.maxAttempts),
  };

  if (phaseNeedsToken(phase)) {
    env.GITHUB_TOKEN = params.token;
  }

  if (phaseNeedsModel(phase)) {
    const keyEnv = LLM_API_KEY_ENV[params.llm.provider];

    if (keyEnv) {
      env[keyEnv] = params.llm.apiKey;
    } else {
      env.LLM_BASE_URL = params.llm.baseUrl;
      env.LLM_NUM_CTX = String(params.llm.numCtx);
    }
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
