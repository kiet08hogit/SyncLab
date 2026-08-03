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
 * The migrate phase is the one that executes untrusted repository code and the
 * repository's own test suite, so it is the one that gets cut off. Clone,
 * install, and pull request creation all legitimately need to reach GitHub.
 */
export function phaseNeedsNetwork(phase: SandboxPhase): boolean {
  return phase !== 'migrate';
}

/**
 * Kept separate from network access on purpose: these are two independent
 * reasons to withhold something from the untrusted phase.
 */
export function phaseNeedsToken(phase: SandboxPhase): boolean {
  return phase !== 'migrate';
}

export function buildPhaseEnv(
  phase: SandboxPhase,
  params: SandboxJobParams,
): Record<string, string> {
  const env: Record<string, string> = {
    REPO_URL: params.repoUrl,
    REPO_FULL_NAME: params.repoFullName,
    DEPENDENCY_NAME: params.dependencyName,
    TARGET_VERSION: params.targetVersion,
    BRANCH_NAME: params.branchName,
    CODEMOD_SEARCH: params.codemodSearch,
    CODEMOD_REPLACE: params.codemodReplace,
    SANDBOX_WORKSPACE: WORKSPACE_MOUNT,
  };

  if (phaseNeedsToken(phase)) {
    env.GITHUB_TOKEN = params.token;
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
