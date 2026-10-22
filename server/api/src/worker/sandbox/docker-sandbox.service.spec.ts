import { PassThrough } from 'node:stream';
import Docker from 'dockerode';
import { DockerSandboxService } from './docker-sandbox.service';
import {
  RESULT_SENTINEL,
  type PhaseResult,
  type SandboxJobParams,
  type SandboxPhase,
  type StepLog,
} from './sandbox.types';

jest.mock('dockerode');

const TIMEOUT_MS = 1000;
const HEAD_SHA = 'a'.repeat(40);
const PASSED: ScriptedRun = { result: { ok: true } };

/** What one phase container prints and how it exits. `hang` never exits. */
interface ScriptedRun {
  result?: Omit<PhaseResult, 'phase' | 'steps'> & { steps?: StepLog[] };
  output?: string;
  exitCode?: number;
  hang?: boolean;
  removeFails?: boolean;
}

function resultLine(phase: SandboxPhase, run: NonNullable<ScriptedRun['result']>): string {
  return `${RESULT_SENTINEL}${JSON.stringify({ phase, steps: [], ...run })}`;
}

/**
 * Fakes the dockerode surface the service uses. Each created container plays
 * the next scripted run for its phase, writing to the attached stream the way
 * the sandbox image does.
 */
const GEMINI_LLM = {
  provider: 'gemini',
  apiKey: 'AIza-test',
  model: 'gemini-3.1-pro-preview',
  maxAttempts: 1,
  maxFiles: 20,
  maxFileBytes: 60_000,
};

function setup(
  script: Partial<Record<SandboxPhase, ScriptedRun[]>>,
  sandbox = {},
  llm: Record<string, unknown> = GEMINI_LLM,
) {
  const created: Array<{ phase: SandboxPhase; env: string[]; binds: string[]; network: string }> =
    [];
  const containers: Array<{ remove: jest.Mock; kill: jest.Mock }> = [];
  const volume = { remove: jest.fn().mockResolvedValue(undefined) };

  const docker = {
    createVolume: jest.fn().mockResolvedValue(undefined),
    getVolume: jest.fn(() => volume),
    getImage: jest.fn(() => ({ inspect: jest.fn().mockResolvedValue({}) })),
    modem: {
      demuxStream: (stream: PassThrough, stdout: PassThrough) => {
        stream.on('data', (chunk: Buffer) => stdout.write(chunk));
      },
    },
    createContainer: jest.fn(
      (options: {
        Cmd: [SandboxPhase];
        Env: string[];
        HostConfig: { Binds: string[]; NetworkMode: string };
      }) => {
        const phase = options.Cmd[0];
        created.push({
          phase,
          env: options.Env,
          binds: options.HostConfig.Binds,
          network: options.HostConfig.NetworkMode,
        });
        const run: ScriptedRun =
          script[phase]?.shift() ??
          (phase === 'prepare' || phase === 'clone'
            ? { result: { ok: true, data: { headSha: HEAD_SHA } } }
            : PASSED);
        const stream = new PassThrough();

        const container = {
          attach: jest.fn().mockResolvedValue(stream),
          start: jest.fn(() => {
            if (!run.hang) {
              const lines = [run.output ?? `${phase} output`];
              if (run.result) {
                lines.push(resultLine(phase, run.result));
              }
              stream.end(`${lines.join('\n')}\n`);
            }
            return Promise.resolve();
          }),
          wait: jest.fn(() =>
            run.hang
              ? new Promise(() => undefined)
              : Promise.resolve({ StatusCode: run.exitCode ?? 0 }),
          ),
          kill: jest.fn().mockResolvedValue(undefined),
          remove: run.removeFails
            ? jest.fn().mockRejectedValue(new Error('already gone'))
            : jest.fn().mockResolvedValue(undefined),
        };
        containers.push(container);
        return Promise.resolve(container);
      },
    ),
  };
  jest.mocked(Docker).mockImplementation(() => docker as never);

  const config = {
    get: (key: string) =>
      key === 'llm'
        ? llm
        : {
            image: 'synclab-sandbox:test',
            timeoutMs: TIMEOUT_MS,
            memoryBytes: 1,
            nanoCpus: 1,
            pidsLimit: 1,
            ...sandbox,
          },
  };
  const service = new DockerSandboxService(config as never);
  const onSteps = jest.fn().mockResolvedValue(undefined);

  return { service, docker, created, containers, volume, onSteps };
}

function params(maxAttempts = 1): SandboxJobParams {
  return {
    repoUrl: 'https://github.com/acme/widgets.git',
    repoFullName: 'acme/widgets',
    migration: { kind: 'dependency', dependencyName: 'react', targetVersion: '19.0.0' },
    branchName: 'synclab/react-19.0.0',
    token: 'gh-token',
    llm: { maxAttempts },
  } as unknown as SandboxJobParams;
}

describe('DockerSandboxService', () => {
  beforeEach(() => {
    jest.mocked(Docker).mockReset();
  });

  describe('constructor', () => {
    it('connects to the configured docker socket', () => {
      setup({}, { dockerSocketPath: '/run/docker.sock' });
      expect(Docker).toHaveBeenCalledWith({ socketPath: '/run/docker.sock' });
    });

    it('uses the docker defaults when no socket is configured', () => {
      setup({});
      expect(Docker).toHaveBeenCalledWith();
    });
  });

  describe('ensureImage', () => {
    it('resolves when the sandbox image exists', async () => {
      const { service, docker } = setup({});

      await expect(service.ensureImage()).resolves.toBeUndefined();
      expect(docker.getImage).toHaveBeenCalledWith('synclab-sandbox:test');
    });

    it('explains how to build a missing image', async () => {
      const { service, docker } = setup({});
      docker.getImage.mockReturnValue({
        inspect: jest.fn().mockRejectedValue(new Error('(HTTP code 404) no such image')),
      });

      await expect(service.ensureImage()).rejects.toThrow(
        'Sandbox image "synclab-sandbox:test" is not available. Build it with `npm run sandbox:build`.',
      );
    });
  });

  describe('run', () => {
    it('runs every phase on one job volume and returns the pull request url', async () => {
      const { service, docker, created, containers, volume, onSteps } = setup({
        prepare: [
          {
            result: {
              ok: true,
              steps: [{ step: 'CLONE', output: 'cloned' }],
              data: { headSha: HEAD_SHA },
            },
          },
        ],
        publish: [
          {
            result: {
              ok: true,
              steps: [{ step: 'PR', output: 'opened' }],
              data: { pullRequestUrl: 'https://github.com/acme/widgets/pull/7' },
            },
          },
        ],
      });

      await expect(service.run('job-1', params(), onSteps)).resolves.toEqual({
        ok: true,
        pullRequestUrl: 'https://github.com/acme/widgets/pull/7',
      });

      expect(docker.createVolume).toHaveBeenCalledWith({
        Name: 'synclab-job-job-1',
        Labels: { 'com.synclab.job': 'job-1' },
      });
      expect(created.map((c) => c.phase)).toEqual([
        'prepare',
        'install',
        'test',
        'upgrade',
        'refactor',
        'test',
        'publish',
      ]);
      for (const container of created) {
        expect(container.binds).toEqual(['synclab-job-job-1:/workspace']);
      }
      expect(onSteps).toHaveBeenNthCalledWith(1, [{ step: 'CLONE', output: 'cloned' }]);
      expect(onSteps).toHaveBeenLastCalledWith([{ step: 'PR', output: 'opened' }]);
      for (const container of containers) {
        expect(container.remove).toHaveBeenCalledWith({ force: true });
      }
      expect(docker.getVolume).toHaveBeenCalledWith('synclab-job-job-1');
      expect(volume.remove).toHaveBeenCalledWith({ force: true });
    });

    it('skips the upgrade for an API change, which keeps the SDK the repository has', async () => {
      const { service, created, onSteps } = setup({});
      const apiChange: SandboxJobParams = {
        ...params(),
        migration: {
          kind: 'api_change',
          change: {
            provider: 'anthropic',
            kind: 'model_retired',
            operation: null,
            field: 'claude-3-opus-20240229',
            replacement: null,
            effectiveAt: null,
            evidence: 'Claude 3 Opus is retired.',
            sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/model-deprecations',
          },
          files: ['src/chat.ts'],
        },
      };

      await expect(service.run('job-1', apiChange, onSteps)).resolves.toMatchObject({ ok: true });

      expect(created.map((c) => c.phase)).toEqual([
        'prepare',
        'install',
        'test',
        'refactor',
        'test',
        'publish',
      ]);
      for (const container of created) {
        expect(container.env).toContain('MIGRATION_KIND=api_change');
        expect(container.env.some((entry) => entry.startsWith('DEPENDENCY_NAME='))).toBe(false);
      }
    });

    it('omits the pull request url when publish does not report one', async () => {
      const { service, onSteps } = setup({});

      await expect(service.run('job-1', params(), onSteps)).resolves.toEqual({
        ok: true,
        pullRequestUrl: undefined,
      });
    });

    it('refactors again after a failing test run, up to the attempt limit', async () => {
      const { service, created, onSteps } = setup({
        test: [PASSED, { result: { ok: false, error: 'first failure' } }, PASSED],
      });

      await expect(service.run('job-1', params(3), onSteps)).resolves.toMatchObject({ ok: true });

      expect(created.map((c) => c.phase)).toEqual([
        'prepare',
        'install',
        'test',
        'upgrade',
        'refactor',
        'test',
        'refactor',
        'test',
        'publish',
      ]);
      const refactorAttempts = created
        .filter((c) => c.phase === 'refactor')
        .map((c) => c.env.find((entry) => entry.startsWith('REFACTOR_ATTEMPT=')));
      expect(refactorAttempts).toEqual(['REFACTOR_ATTEMPT=1', 'REFACTOR_ATTEMPT=2']);
    });

    it('gives up without publishing when the tests never pass', async () => {
      const { service, created, volume, onSteps } = setup({
        test: [
          PASSED,
          { result: { ok: false, error: 'first failure' } },
          { result: { ok: false, error: 'second failure' } },
        ],
      });

      await expect(service.run('job-1', params(2), onSteps)).resolves.toEqual({
        ok: false,
        error: 'tests still failing after 2 refactor attempt(s): second failure',
      });
      expect(created.map((c) => c.phase)).not.toContain('publish');
      expect(volume.remove).toHaveBeenCalled();
    });

    it('stops after a failed prepare', async () => {
      const { service, created, onSteps } = setup({
        prepare: [{ result: { ok: false, error: 'clone failed' } }],
      });

      await expect(service.run('job-1', params(), onSteps)).resolves.toEqual({
        ok: false,
        error: 'clone failed',
      });
      expect(created.map((c) => c.phase)).toEqual(['prepare']);
    });

    it.each([
      ['retryable', { retryable: true }, true],
      ['permanent', undefined, false],
    ])('reports a %s refactor failure', async (_kind, data, retryable) => {
      const { service, created, onSteps } = setup({
        refactor: [{ result: { ok: false, error: 'model said no', data } }],
      });

      await expect(service.run('job-1', params(), onSteps)).resolves.toEqual({
        ok: false,
        error: 'model said no',
        retryable,
      });
      expect(created.map((c) => c.phase)).toEqual([
        'prepare',
        'install',
        'test',
        'upgrade',
        'refactor',
      ]);
    });

    it('proves the suite on the current version before upgrading', async () => {
      const { service, created, onSteps } = setup({});

      await service.run('job-1', params(), onSteps);

      const [baseline, afterRefactor] = created.filter((c) => c.phase === 'test');
      expect(baseline.env).toContain('TEST_BASELINE=true');
      expect(afterRefactor.env).not.toContain('TEST_BASELINE=true');
      expect(created.findIndex((c) => c.phase === 'upgrade')).toBeGreaterThan(
        created.indexOf(baseline),
      );
    });

    it('stops before the upgrade when the suite already fails, without a retry', async () => {
      const { service, created, onSteps } = setup({
        test: [{ result: { ok: false, error: 'test suite failed with exit code 1' } }],
      });

      await expect(service.run('job-1', params(3), onSteps)).resolves.toEqual({
        ok: false,
        error:
          'the test suite already fails before the upgrade, so a migration cannot be verified: test suite failed with exit code 1',
      });
      expect(created.map((c) => c.phase)).toEqual(['prepare', 'install', 'test']);
    });

    it('says a failing baseline stopped an API change before the migration', async () => {
      const { service, created, onSteps } = setup({
        test: [{ result: { ok: false, error: 'test suite failed with exit code 1' } }],
      });
      const apiChange: SandboxJobParams = {
        ...params(),
        migration: {
          kind: 'api_change',
          change: {
            provider: 'anthropic',
            kind: 'model_retired',
            operation: null,
            field: 'claude-3-opus-20240229',
            replacement: null,
            effectiveAt: null,
            evidence: 'Claude 3 Opus is retired.',
            sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/model-deprecations',
          },
          files: ['src/chat.ts'],
        },
      };

      await expect(service.run('job-1', apiChange, onSteps)).resolves.toEqual({
        ok: false,
        error:
          'the test suite already fails before the migration, so a migration cannot be verified: test suite failed with exit code 1',
      });
      expect(created.map((c) => c.phase)).toEqual(['prepare', 'install', 'test']);
    });

    it.each([
      ['install', ['prepare', 'install']],
      ['upgrade', ['prepare', 'install', 'test', 'upgrade']],
    ] as const)('stops after a failed %s', async (phase, ran) => {
      const { service, created, onSteps } = setup({
        [phase]: [{ result: { ok: false, error: `${phase} broke` } }],
      });

      await expect(service.run('job-1', params(), onSteps)).resolves.toEqual({
        ok: false,
        error: `${phase} broke`,
      });
      expect(created.map((c) => c.phase)).toEqual(ran);
    });

    it('stops when prepare does not report the commit it cloned', async () => {
      const { service, created, onSteps } = setup({ prepare: [PASSED] });

      await expect(service.run('job-1', params(), onSteps)).resolves.toEqual({
        ok: false,
        error: 'sandbox phase "prepare" did not report the cloned commit',
      });
      expect(created.map((c) => c.phase)).toEqual(['prepare']);
    });

    it('tells publish which commit to base the branch on', async () => {
      const { service, created, onSteps } = setup({});

      await service.run('job-1', params(), onSteps);

      const publish = created.find((c) => c.phase === 'publish');
      expect(publish?.env).toContain(`BASE_SHA=${HEAD_SHA}`);
      for (const other of created.filter((c) => c.phase !== 'publish')) {
        expect(other.env.some((entry) => entry.startsWith('BASE_SHA='))).toBe(false);
      }
    });

    it('reports a failed publish', async () => {
      const { service, onSteps } = setup({ publish: [{ result: { ok: false } }] });

      await expect(service.run('job-1', params(), onSteps)).resolves.toEqual({
        ok: false,
        error: 'sandbox phase "publish" failed',
      });
    });

    it('reports a publish with no changes as a non-retryable failure', async () => {
      const { service, onSteps } = setup({
        publish: [{ result: { ok: true, data: { skipped: true } } }],
      });

      await expect(service.run('job-1', params(), onSteps)).resolves.toEqual({
        ok: false,
        error: 'refactor produced no changes',
      });
    });

    it('keeps the raw log when a container dies without reporting a result', async () => {
      const { service, onSteps } = setup({ prepare: [{ output: 'Killed', exitCode: 137 }] });

      await expect(service.run('job-1', params(), onSteps)).resolves.toEqual({
        ok: false,
        error: 'sandbox phase "prepare" exited with code 137 without reporting a result',
      });
      expect(onSteps).toHaveBeenCalledWith([{ step: 'CLONE', output: 'Killed', exitCode: 137 }]);
    });

    it.each([
      ['install', 'INSTALL'],
      ['upgrade', 'UPGRADE'],
      ['refactor', 'REFACTOR'],
      ['publish', 'PR'],
    ] as const)(
      'logs a %s phase that died without a result under the %s stage',
      async (phase, step) => {
        const { service, onSteps } = setup({
          [phase]: [{ output: 'Killed', exitCode: 137 }],
        });

        await service.run('job-1', params(), onSteps);

        expect(onSteps).toHaveBeenCalledWith([{ step, output: 'Killed', exitCode: 137 }]);
      },
    );

    it('logs a baseline test run that died without a result as BASELINE, not TEST', async () => {
      const { service, onSteps } = setup({ test: [{ output: 'Killed', exitCode: 137 }] });

      await service.run('job-1', params(), onSteps);

      expect(onSteps).toHaveBeenCalledWith([{ step: 'BASELINE', output: 'Killed', exitCode: 137 }]);
    });

    it('kills a phase that exceeds the timeout and still cleans up', async () => {
      jest.useFakeTimers();
      try {
        const { service, containers, volume, onSteps } = setup({ prepare: [{ hang: true }] });

        const outcome = service.run('job-1', params(), onSteps);
        const assertion = expect(outcome).rejects.toThrow(
          `Sandbox phase "prepare" exceeded ${TIMEOUT_MS}ms and was killed`,
        );
        await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
        await assertion;

        expect(containers[0].kill).toHaveBeenCalled();
        expect(containers[0].remove).toHaveBeenCalledWith({ force: true });
        expect(volume.remove).toHaveBeenCalledWith({ force: true });
        expect(onSteps).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('returns the outcome even when cleanup fails', async () => {
      const { service, volume, onSteps } = setup({
        prepare: [{ result: { ok: true, data: { headSha: HEAD_SHA } }, removeFails: true }],
      });
      volume.remove.mockRejectedValue(new Error('volume in use'));

      await expect(service.run('job-1', params(), onSteps)).resolves.toMatchObject({ ok: true });
      expect(volume.remove).toHaveBeenCalled();
    });
  });
});

describe('DockerSandboxService.scan', () => {
  const USAGE = {
    provider: 'anthropic',
    file: 'src/llm/chain.ts',
    line: 4,
    style: 'sdk',
    method: 'beta.messages.stream',
    operation: 'POST /v1/messages',
    params: ['max_tokens', 'messages', 'model'],
    modelIds: [],
    dynamic: true,
  };
  const SCAN_PARAMS = { repoUrl: 'https://github.com/acme/widgets.git', token: 'gh-token' };

  beforeEach(() => {
    jest.mocked(Docker).mockReset();
  });

  it('clones with the token, then scans offline without it, on one scan volume', async () => {
    const { service, docker, created, volume } = setup({
      clone: [
        {
          result: {
            ok: true,
            steps: [{ step: 'CLONE', output: 'cloned' }],
            data: { headSha: HEAD_SHA },
          },
        },
      ],
      scan: [
        {
          result: {
            ok: true,
            steps: [{ step: 'SCAN', output: 'found 1' }],
            data: { usages: [USAGE] },
          },
        },
      ],
    });

    await expect(service.scan('scan-1', SCAN_PARAMS)).resolves.toEqual({
      ok: true,
      commitSha: HEAD_SHA,
      usages: [USAGE],
      output: '[CLONE]\ncloned\n\n[SCAN]\nfound 1',
    });

    expect(docker.createVolume).toHaveBeenCalledWith({
      Name: 'synclab-scan-scan-1',
      Labels: { 'com.synclab.scan': 'scan-1' },
    });
    expect(created.map(({ phase, network }) => [phase, network])).toEqual([
      ['clone', 'bridge'],
      ['scan', 'none'],
    ]);
    expect(created[0].env).toContain('GITHUB_TOKEN=gh-token');
    expect(created[0].env).toContain('REPO_URL=https://github.com/acme/widgets.git');
    expect(created[1].env.filter((entry) => !entry.startsWith('SANDBOX_WORKSPACE='))).toEqual([]);
    for (const container of created) {
      expect(container.binds).toEqual(['synclab-scan-scan-1:/workspace']);
    }
    expect(volume.remove).toHaveBeenCalledWith({ force: true });
  });

  it('stops after a failed clone without scanning', async () => {
    const { service, created, volume } = setup({
      clone: [{ result: { ok: false, error: 'git clone failed' } }],
    });

    await expect(service.scan('scan-1', SCAN_PARAMS)).resolves.toMatchObject({
      ok: false,
      error: 'git clone failed',
      usages: [],
    });
    expect(created.map((c) => c.phase)).toEqual(['clone']);
    expect(volume.remove).toHaveBeenCalled();
  });

  it('reports a scan container that died without a result, with its log', async () => {
    const { service } = setup({ scan: [{ output: 'out of memory', exitCode: 137 }] });

    const outcome = await service.scan('scan-1', SCAN_PARAMS);

    expect(outcome).toMatchObject({ ok: false, commitSha: HEAD_SHA, usages: [] });
    expect(outcome.error).toMatch(/"scan" exited with code 137/);
    expect(outcome.output).toContain('[SCAN]\nout of memory');
  });

  it('drops a usage that does not fit the registry', async () => {
    const { service } = setup({
      scan: [
        {
          result: {
            ok: true,
            data: {
              usages: [
                USAGE,
                { ...USAGE, file: 'x'.repeat(1025) },
                { ...USAGE, provider: 'gemini' },
              ],
            },
          },
        },
      ],
    });

    await expect(service.scan('scan-1', SCAN_PARAMS)).resolves.toMatchObject({ usages: [USAGE] });
  });
});

describe('DockerSandboxService.classify', () => {
  const INPUT = {
    provider: 'anthropic' as const,
    sourceKind: 'sdk_changelog' as const,
    url: 'https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/CHANGELOG.md',
    text: '## Features\n* remove relationship in favor of access_type',
  };
  const CHANGE = {
    kind: 'param_renamed',
    operation: null,
    field: 'relationship',
    replacement: 'access_type',
    effectiveAt: null,
    evidence: 'remove relationship in favor of access_type',
  };
  const ANTHROPIC_LLM = {
    ...GEMINI_LLM,
    provider: 'anthropic',
    apiKey: 'sk-ant-test',
    model: 'claude-opus-5-5',
  };

  beforeEach(() => {
    jest.mocked(Docker).mockReset();
  });

  it('runs classify on its own volume with the model settings and no token, then removes the volume', async () => {
    const { service, docker, created, volume } = setup(
      {
        classify: [
          {
            result: {
              ok: true,
              steps: [{ step: 'CLASSIFY', output: 'Found 1 breaking change(s).' }],
              data: { changes: [CHANGE], dropped: 0 },
            },
          },
        ],
      },
      {},
      ANTHROPIC_LLM,
    );

    await expect(service.classify(INPUT)).resolves.toEqual({
      ok: true,
      changes: [CHANGE],
      output: '[CLASSIFY]\nFound 1 breaking change(s).',
    });

    expect(created.map(({ phase, network }) => [phase, network])).toEqual([['classify', 'bridge']]);
    const [[volume0]] = docker.createVolume.mock.calls as Array<[{ Name: string }]>;
    const volumeName = volume0.Name;
    expect(volumeName).toMatch(/^synclab-classify-[0-9a-f-]{36}$/);
    expect(created[0].binds).toEqual([`${volumeName}:/workspace`]);
    const env: Record<string, string> = Object.fromEntries(
      created[0].env.map((entry) => entry.split(/=(.*)/s) as [string, string]),
    );
    expect(JSON.parse(Buffer.from(env.CLASSIFY_INPUT, 'base64').toString('utf8'))).toEqual(INPUT);
    expect(env.LLM_PROVIDER).toBe('anthropic');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(volume.remove).toHaveBeenCalledWith({ force: true });
  });

  it('reports a failed classification, and whether it is worth retrying', async () => {
    const { service, volume } = setup(
      {
        classify: [
          {
            result: {
              ok: false,
              error: 'model call failed: 429 Too Many Requests',
              steps: [{ step: 'CLASSIFY', output: '429 Too Many Requests' }],
              data: { retryable: true },
            },
          },
        ],
      },
      {},
      ANTHROPIC_LLM,
    );

    await expect(service.classify(INPUT)).resolves.toEqual({
      ok: false,
      error: 'model call failed: 429 Too Many Requests',
      retryable: true,
      changes: [],
      output: '[CLASSIFY]\n429 Too Many Requests',
    });
    expect(volume.remove).toHaveBeenCalled();
  });

  it('reports a container that died without a result, with its log', async () => {
    const { service } = setup(
      { classify: [{ output: 'out of memory', exitCode: 137 }] },
      {},
      ANTHROPIC_LLM,
    );

    const outcome = await service.classify(INPUT);

    expect(outcome).toMatchObject({ ok: false, retryable: false, changes: [] });
    expect(outcome.error).toMatch(/"classify" exited with code 137/);
    expect(outcome.output).toContain('out of memory');
  });

  it('removes the volume even when the container times out', async () => {
    const { service, volume } = setup({ classify: [{ hang: true }] }, {}, ANTHROPIC_LLM);

    await expect(service.classify(INPUT)).rejects.toThrow(/exceeded 1000ms/);
    expect(volume.remove).toHaveBeenCalledWith({ force: true });
  });

  it('does not start a container when the hosted provider has no key', async () => {
    const { service, docker } = setup({}, {}, { ...ANTHROPIC_LLM, apiKey: '' });

    await expect(service.classify(INPUT)).resolves.toEqual({
      ok: false,
      error:
        'LLM_PROVIDER is anthropic but ANTHROPIC_API_KEY is not set, so the classify phase cannot run.',
      changes: [],
      output: '',
    });
    expect(docker.createVolume).not.toHaveBeenCalled();
    expect(docker.createContainer).not.toHaveBeenCalled();
  });
});
