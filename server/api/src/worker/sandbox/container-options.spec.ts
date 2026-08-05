import {
  WORKSPACE_MOUNT,
  buildContainerOptions,
  buildPhaseEnv,
  type SandboxLimits,
} from './container-options';
import { SANDBOX_PHASES, type SandboxJobParams, type SandboxPhase } from './sandbox.types';

const TOKEN = 'ghs_supersecrettoken';

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
  codemodSearch: 'DEPRECATED_API',
  codemodReplace: 'MODERN_API',
  token: TOKEN,
};

function optionsFor(phase: SandboxPhase) {
  return buildContainerOptions({
    phase,
    image: 'synclab-sandbox:latest',
    volumeName: 'synclab-job-abc',
    env: buildPhaseEnv(phase, PARAMS),
    limits: LIMITS,
  });
}

describe('buildPhaseEnv', () => {
  it('withholds the GitHub token from the phase that runs untrusted code', () => {
    expect(buildPhaseEnv('migrate', PARAMS).GITHUB_TOKEN).toBeUndefined();
  });

  it('provides the GitHub token to the phases that talk to GitHub', () => {
    expect(buildPhaseEnv('prepare', PARAMS).GITHUB_TOKEN).toBe(TOKEN);
    expect(buildPhaseEnv('publish', PARAMS).GITHUB_TOKEN).toBe(TOKEN);
  });
});

describe('buildContainerOptions', () => {
  it('disables networking only for the migrate phase', () => {
    expect(optionsFor('prepare').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('migrate').HostConfig?.NetworkMode).toBe('none');
    expect(optionsFor('publish').HostConfig?.NetworkMode).toBe('bridge');
  });

  it('keeps the token out of the migrate container environment entirely', () => {
    const env = optionsFor('migrate').Env ?? [];
    expect(env.some((entry) => entry.includes(TOKEN))).toBe(false);
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
