import type { ContainerCreateOptions } from 'dockerode';
import { LLM_API_KEY_ENV } from '../../config/configuration';
import type {
  SandboxClassifyInput,
  SandboxJobParams,
  SandboxLlmParams,
  SandboxMigration,
  SandboxPhase,
  SandboxScanParams,
} from './sandbox.types';

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
 * and instead never receive a token. Refactor and classify need the model
 * provider and only run SyncLab's own code. Scan only parses the clone, so it
 * has no reason to reach anything.
 */
export function phaseNeedsNetwork(phase: SandboxPhase): boolean {
  return phase !== 'test' && phase !== 'scan';
}

/**
 * Kept separate from network access on purpose: these are independent reasons
 * to withhold something from a phase. Only the phases that clone or push, and
 * run nothing but SyncLab's own code, get the token; install scripts and the
 * test suite never run beside it, and refactor, scan and classify have no
 * business reaching GitHub.
 */
export function phaseNeedsToken(phase: SandboxPhase): boolean {
  return phase === 'prepare' || phase === 'clone' || phase === 'publish';
}

export function phaseNeedsModel(phase: SandboxPhase): boolean {
  return phase === 'refactor' || phase === 'classify';
}

function modelEnv(llm: SandboxLlmParams): Record<string, string> {
  return { [LLM_API_KEY_ENV[llm.provider]]: llm.apiKey };
}

function migrationEnv(migration: SandboxMigration): Record<string, string> {
  if (migration.kind === 'dependency') {
    return {
      DEPENDENCY_NAME: migration.dependencyName,
      TARGET_VERSION: migration.targetVersion,
    };
  }

  return {
    MIGRATION_KIND: 'api_change',
    API_CHANGE: JSON.stringify(migration.change),
    TARGET_FILES: JSON.stringify(migration.files),
  };
}

export function buildPhaseEnv(
  phase: SandboxPhase,
  params: SandboxJobParams,
  attempt: number,
): Record<string, string> {
  const env: Record<string, string> = {
    REPO_URL: params.repoUrl,
    REPO_FULL_NAME: params.repoFullName,
    ...migrationEnv(params.migration),
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
    Object.assign(env, modelEnv(params.llm));
  }

  return env;
}

/**
 * A scan carries no migration, so its phases get only the workspace, what to
 * clone, and the token where phaseNeedsToken allows it.
 */
export function buildScanPhaseEnv(
  phase: Extract<SandboxPhase, 'clone' | 'scan'>,
  params: SandboxScanParams,
): Record<string, string> {
  const env: Record<string, string> = { SANDBOX_WORKSPACE: WORKSPACE_MOUNT };

  if (phase === 'clone') {
    env.REPO_URL = params.repoUrl;
  }

  if (phaseNeedsToken(phase)) {
    env.GITHUB_TOKEN = params.token;
  }

  return env;
}

/**
 * The most text one classification sends. Base64 makes it a third larger, so
 * CLASSIFY_INPUT stays near 64 KB: well under the 128 KB Linux allows a single
 * environment string.
 */
export const MAX_CLASSIFY_TEXT_BYTES = 48 * 1024;

/**
 * Cuts the text to MAX_CLASSIFY_TEXT_BYTES at a line break. Release notes and
 * changelogs list the newest entries first, so keeping the start keeps the
 * newest changes; what is cut is the oldest, which an earlier poll has
 * usually already classified.
 */
export function capClassifyText(text: string): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= MAX_CLASSIFY_TEXT_BYTES) {
    return { text, truncated: false };
  }

  // Decoding a cut that splits a character leaves a replacement character at
  // the end, which the cut at the last line break then removes.
  const head = bytes.subarray(0, MAX_CLASSIFY_TEXT_BYTES).toString('utf8');
  const lastBreak = head.lastIndexOf('\n');

  return {
    text: lastBreak > 0 ? head.slice(0, lastBreak) : head.replace(/\uFFFD+$/, ''),
    truncated: true,
  };
}

/**
 * Classify reads nothing from the volume and reaches nothing but the model, so
 * it gets only its input and the model's key: never the GitHub token.
 */
export function buildClassifyPhaseEnv(
  input: SandboxClassifyInput,
  llm: SandboxLlmParams,
): Record<string, string> {
  const capped: SandboxClassifyInput = { ...input, text: capClassifyText(input.text).text };

  return {
    SANDBOX_WORKSPACE: WORKSPACE_MOUNT,
    CLASSIFY_INPUT: Buffer.from(JSON.stringify(capped), 'utf8').toString('base64'),
    LLM_PROVIDER: llm.provider,
    LLM_MODEL: llm.model,
    ...modelEnv(llm),
  };
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
