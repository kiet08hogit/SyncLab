import {
  WORKSPACE_MOUNT,
  buildContainerOptions,
  buildPhaseEnv,
  type SandboxLimits,
} from './container-options';
import { SANDBOX_PHASES, type SandboxJobParams, type SandboxPhase } from './sandbox.types';

const TOKEN = 'ghs_supersecrettoken';
const API_KEY = 'AIza_supersecretgeminikey';

const LIMITS: SandboxLimits = {
  memoryBytes: 2048 * 1024 * 1024,
  nanoCpus: 1e9,
  pidsLimit: 512,
};

const PARAMS: SandboxJobParams = {
  repoUrl: 'https://github.com/acme/widgets.git',
  repoFullName: 'acme/widgets',
  dependencyName: 'react',
  targetVersion: 'v18.0.0',
  branchName: 'synclab/react-v18-0-0',
  token: TOKEN,
  llm: {
    apiKey: API_KEY,
    model: 'gemini-3.1-pro-preview',
    maxAttempts: 3,
    maxFiles: 20,
    maxFileBytes: 60_000,
  },
};

function optionsFor(phase: SandboxPhase, attempt = 1) {
  return buildContainerOptions({
    phase,
    image: 'synclab-sandbox:latest',
    volumeName: 'synclab-job-abc',
    env: buildPhaseEnv(phase, PARAMS, attempt),
    limits: LIMITS,
  });
}

describe('buildPhaseEnv', () => {
  it('withholds the GitHub token from the phase that runs untrusted code', () => {
    expect(buildPhaseEnv('test', PARAMS, 1).GITHUB_TOKEN).toBeUndefined();
  });

  it('withholds the GitHub token from refactor, which has no reason to reach GitHub', () => {
    expect(buildPhaseEnv('refactor', PARAMS, 1).GITHUB_TOKEN).toBeUndefined();
  });

  it('provides the GitHub token to the phases that talk to GitHub', () => {
    expect(buildPhaseEnv('prepare', PARAMS, 1).GITHUB_TOKEN).toBe(TOKEN);
    expect(buildPhaseEnv('publish', PARAMS, 1).GITHUB_TOKEN).toBe(TOKEN);
  });

  it('gives the model key only to the refactor phase', () => {
    expect(buildPhaseEnv('refactor', PARAMS, 1).GEMINI_API_KEY).toBe(API_KEY);

    for (const phase of ['prepare', 'test', 'publish'] as const) {
      expect(buildPhaseEnv(phase, PARAMS, 1).GEMINI_API_KEY).toBeUndefined();
    }
  });

  it('passes the attempt counter through so a retry can correct itself', () => {
    const env = buildPhaseEnv('refactor', PARAMS, 2);

    expect(env.REFACTOR_ATTEMPT).toBe('2');
    expect(env.REFACTOR_MAX_ATTEMPTS).toBe('3');
  });
});

describe('buildContainerOptions', () => {
  it('disables networking only for the phase that runs the repository test suite', () => {
    expect(optionsFor('prepare').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('refactor').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('test').HostConfig?.NetworkMode).toBe('none');
    expect(optionsFor('publish').HostConfig?.NetworkMode).toBe('bridge');
  });

  it('keeps every credential out of the test container environment', () => {
    const env = optionsFor('test').Env ?? [];

    expect(env.some((entry) => entry.includes(TOKEN))).toBe(false);
    expect(env.some((entry) => entry.includes(API_KEY))).toBe(false);
  });

  it('passes the phase as the container command', () => {
    for (const phase of SANDBOX_PHASES) {
      expect(optionsFor(phase).Cmd).toEqual([phase]);
    }
  });

  describe.each(SANDBOX_PHASES)('security limits for the %s phase', (phase) => {
    it('applies memory, CPU, and PID ceilings', () => {
      const hostConfig = optionsFor(phase).HostConfig;

      expect(hostConfig?.Memory).toBe(LIMITS.memoryBytes);
      // Equal to Memory so the container cannot escape the limit via swap.
      expect(hostConfig?.MemorySwap).toBe(LIMITS.memoryBytes);
      expect(hostConfig?.NanoCpus).toBe(LIMITS.nanoCpus);
      expect(hostConfig?.PidsLimit).toBe(LIMITS.pidsLimit);
    });

    it('drops capabilities, blocks privilege escalation, and runs as a non-root user', () => {
      const options = optionsFor(phase);

      expect(options.User).toBe('node');
      expect(options.HostConfig?.CapDrop).toEqual(['ALL']);
      expect(options.HostConfig?.SecurityOpt).toEqual(['no-new-privileges']);
    });

    it('mounts only the job volume and no host path', () => {
      const binds = optionsFor(phase).HostConfig?.Binds ?? [];

      expect(binds).toEqual([`synclab-job-abc:${WORKSPACE_MOUNT}`]);
      expect(binds.some((bind) => bind.startsWith('/'))).toBe(false);
    });
  });
});
