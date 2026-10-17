import {
  WORKSPACE_MOUNT,
  buildContainerOptions,
  buildPhaseEnv,
  buildScanPhaseEnv,
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
    provider: 'gemini',
    apiKey: API_KEY,
    baseUrl: 'http://host.docker.internal:11434',
    numCtx: 32_768,
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

  it.each(['install', 'upgrade'] as const)(
    'withholds every credential from %s, which runs dependency install scripts',
    (phase) => {
      const env = buildPhaseEnv(phase, PARAMS, 1);

      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.GEMINI_API_KEY).toBeUndefined();
      expect(Object.values(env)).not.toContain(TOKEN);
    },
  );

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

  it('gives the Anthropic key, and no other, only to the refactor phase', () => {
    const anthropic: SandboxJobParams = {
      ...PARAMS,
      llm: {
        ...PARAMS.llm,
        provider: 'anthropic',
        apiKey: 'sk-ant-test',
        model: 'claude-opus-5-5',
      },
    };
    const env = buildPhaseEnv('refactor', anthropic, 1);

    expect(env.LLM_PROVIDER).toBe('anthropic');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.LLM_BASE_URL).toBeUndefined();

    for (const phase of ['prepare', 'test', 'publish'] as const) {
      expect(buildPhaseEnv(phase, anthropic, 1).ANTHROPIC_API_KEY).toBeUndefined();
    }
  });

  it('gives the Ollama endpoint only to the refactor phase, and no key at all', () => {
    const ollama: SandboxJobParams = {
      ...PARAMS,
      llm: { ...PARAMS.llm, provider: 'ollama', model: 'qwen2.5-coder:14b' },
    };
    const env = buildPhaseEnv('refactor', ollama, 1);

    expect(env.LLM_PROVIDER).toBe('ollama');
    expect(env.LLM_BASE_URL).toBe('http://host.docker.internal:11434');
    expect(env.LLM_NUM_CTX).toBe('32768');
    expect(env.GEMINI_API_KEY).toBeUndefined();

    for (const phase of ['prepare', 'test', 'publish'] as const) {
      expect(buildPhaseEnv(phase, ollama, 1).LLM_BASE_URL).toBeUndefined();
    }
  });

  it('passes the attempt counter through so a retry can correct itself', () => {
    const env = buildPhaseEnv('refactor', PARAMS, 2);

    expect(env.REFACTOR_ATTEMPT).toBe('2');
    expect(env.REFACTOR_MAX_ATTEMPTS).toBe('3');
  });
});

describe('buildScanPhaseEnv', () => {
  const scanParams = { repoUrl: 'https://github.com/acme/widgets.git', token: TOKEN };

  it('gives clone what to clone and the token, and nothing about a migration or a model', () => {
    expect(buildScanPhaseEnv('clone', scanParams)).toEqual({
      SANDBOX_WORKSPACE: WORKSPACE_MOUNT,
      REPO_URL: 'https://github.com/acme/widgets.git',
      GITHUB_TOKEN: TOKEN,
    });
  });

  it('gives scan only the workspace: no token, no repository URL', () => {
    expect(buildScanPhaseEnv('scan', scanParams)).toEqual({ SANDBOX_WORKSPACE: WORKSPACE_MOUNT });
  });
});

describe('buildContainerOptions', () => {
  it('disables networking for the test suite and for the scan, which only parses files', () => {
    expect(optionsFor('prepare').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('refactor').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('install').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('upgrade').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('test').HostConfig?.NetworkMode).toBe('none');
    expect(optionsFor('publish').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('clone').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('scan').HostConfig?.NetworkMode).toBe('none');
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
