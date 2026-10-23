import {
  MAX_CLASSIFY_TEXT_BYTES,
  WORKSPACE_MOUNT,
  buildClassifyPhaseEnv,
  buildContainerOptions,
  buildPhaseEnv,
  buildScanPhaseEnv,
  capClassifyText,
  phaseNeedsModel,
  phaseNeedsNetwork,
  phaseNeedsToken,
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
  migration: { kind: 'dependency', dependencyName: 'react', targetVersion: 'v18.0.0' },
  branchName: 'synclab/react-v18-0-0',
  token: TOKEN,
  validationContext: '{}',
  llm: {
    provider: 'gemini',
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

  it('gives the validation context only to validate, and no credential', () => {
    const withContext: SandboxJobParams = { ...PARAMS, validationContext: '{"rescan":{}}' };
    const env = buildPhaseEnv('validate', withContext, 1);

    expect(env.VALIDATE_CONTEXT).toBe('{"rescan":{}}');
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(buildPhaseEnv('refactor', withContext, 1).VALIDATE_CONTEXT).toBeUndefined();
    expect(buildPhaseEnv('test', withContext, 1).VALIDATE_CONTEXT).toBeUndefined();
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

    for (const phase of ['prepare', 'test', 'validate', 'publish'] as const) {
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

    for (const phase of ['prepare', 'test', 'validate', 'publish'] as const) {
      expect(buildPhaseEnv(phase, anthropic, 1).ANTHROPIC_API_KEY).toBeUndefined();
    }
  });

  it('passes the attempt counter through so a retry can correct itself', () => {
    const env = buildPhaseEnv('refactor', PARAMS, 2);

    expect(env.REFACTOR_ATTEMPT).toBe('2');
    expect(env.REFACTOR_MAX_ATTEMPTS).toBe('3');
  });

  it('describes a dependency job the way the sandbox has always read it', () => {
    const env = buildPhaseEnv('refactor', PARAMS, 1);

    expect(env.DEPENDENCY_NAME).toBe('react');
    expect(env.TARGET_VERSION).toBe('v18.0.0');
    expect(env.MIGRATION_KIND).toBeUndefined();
    expect(env.API_CHANGE).toBeUndefined();
  });

  it('hands an API change its brief and files, and no dependency to upgrade', () => {
    const change = {
      provider: 'anthropic',
      kind: 'model_retired',
      operation: 'POST /v1/messages',
      field: 'claude-3-opus-20240229',
      replacement: null,
      effectiveAt: '2026-01-05',
      evidence: 'Claude 3 Opus is retired on January 5, 2026.',
      sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/model-deprecations',
    };
    const env = buildPhaseEnv(
      'refactor',
      { ...PARAMS, migration: { kind: 'api_change', change, files: ['src/chat.ts'] } },
      1,
    );

    expect(env.MIGRATION_KIND).toBe('api_change');
    expect(JSON.parse(env.API_CHANGE)).toEqual(change);
    expect(JSON.parse(env.TARGET_FILES)).toEqual(['src/chat.ts']);
    expect(env.DEPENDENCY_NAME).toBeUndefined();
    expect(env.TARGET_VERSION).toBeUndefined();
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

describe('buildClassifyPhaseEnv', () => {
  const input = {
    provider: 'openai' as const,
    sourceKind: 'release_notes' as const,
    url: 'https://developers.openai.com/api/docs/changelog',
    text: '## Oct 1\nThe `functions` parameter has been removed. Ünïcode ✓',
  };

  function decode(env: Record<string, string>): unknown {
    return JSON.parse(Buffer.from(env.CLASSIFY_INPUT, 'base64').toString('utf8'));
  }

  it('passes the input as base64 JSON with the model key and nothing else', () => {
    const env = buildClassifyPhaseEnv(input, PARAMS.llm);

    expect(decode(env)).toEqual(input);
    expect(env).toEqual({
      SANDBOX_WORKSPACE: WORKSPACE_MOUNT,
      CLASSIFY_INPUT: env.CLASSIFY_INPUT,
      LLM_PROVIDER: 'gemini',
      LLM_MODEL: 'gemini-3.1-pro-preview',
      GEMINI_API_KEY: API_KEY,
    });
    expect(Object.values(env)).not.toContain(TOKEN);
  });

  it('caps the text so the environment stays far under the OS limit', () => {
    const line = `${'x'.repeat(99)}\n`;
    const env = buildClassifyPhaseEnv({ ...input, text: line.repeat(5_000) }, PARAMS.llm);
    const { text } = decode(env) as { text: string };

    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_CLASSIFY_TEXT_BYTES);
    expect(text.startsWith(line)).toBe(true);
    expect(env.CLASSIFY_INPUT.length).toBeLessThan(70 * 1024);
  });

  it('treats classify like refactor: model and network, never the GitHub token', () => {
    expect(phaseNeedsModel('classify')).toBe(true);
    expect(phaseNeedsNetwork('classify')).toBe(true);
    expect(phaseNeedsToken('classify')).toBe(false);
  });
});

describe('capClassifyText', () => {
  it('leaves text under the cap alone', () => {
    expect(capClassifyText('a\nb')).toEqual({ text: 'a\nb', truncated: false });
  });

  it('keeps the start, which holds the newest notes, and cuts at a line break', () => {
    const newest = '## Oct 2\nNewest entry';
    const { text, truncated } = capClassifyText(`${newest}\n${'old line\n'.repeat(10_000)}`);

    expect(truncated).toBe(true);
    expect(text.startsWith(newest)).toBe(true);
    expect(text.endsWith('old line')).toBe(true);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_CLASSIFY_TEXT_BYTES);
  });

  it('never splits a multibyte character when there is no line break', () => {
    const { text } = capClassifyText('✓'.repeat(MAX_CLASSIFY_TEXT_BYTES));

    expect(text).toMatch(/^✓+$/);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_CLASSIFY_TEXT_BYTES);
  });
});

describe('buildContainerOptions', () => {
  it('disables networking for the test suite, the scan, and validation', () => {
    expect(optionsFor('prepare').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('refactor').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('install').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('upgrade').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('test').HostConfig?.NetworkMode).toBe('none');
    expect(optionsFor('validate').HostConfig?.NetworkMode).toBe('none');
    expect(optionsFor('publish').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('clone').HostConfig?.NetworkMode).toBe('bridge');
    expect(optionsFor('scan').HostConfig?.NetworkMode).toBe('none');
    expect(optionsFor('classify').HostConfig?.NetworkMode).toBe('bridge');
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
