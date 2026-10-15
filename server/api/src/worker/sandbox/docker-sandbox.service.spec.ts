import { DockerSandboxService } from './docker-sandbox.service';
import type { PhaseResult, SandboxJobParams, SandboxPhase } from './sandbox.types';

function makeService() {
  const config = {
    get: () => ({
      image: 'synclab-sandbox:test',
      timeoutMs: 1000,
      memoryBytes: 1,
      nanoCpus: 1,
      pidsLimit: 1,
    }),
  };
  const service = new DockerSandboxService(config as never);

  Object.assign(service, {
    docker: {
      createVolume: jest.fn().mockResolvedValue(undefined),
      getVolume: () => ({ remove: jest.fn().mockResolvedValue(undefined) }),
    },
  });

  return service;
}

describe('DockerSandboxService.run', () => {
  it('reports a publish with no changes as a non-retryable failure', async () => {
    const service = makeService();

    jest
      .spyOn(
        service as unknown as { runPhase: (phase: SandboxPhase) => Promise<PhaseResult> },
        'runPhase',
      )
      .mockImplementation((phase) =>
        Promise.resolve(
          phase === 'publish'
            ? { phase, ok: true, steps: [], data: { skipped: true } }
            : { phase, ok: true, steps: [] },
        ),
      );

    const outcome = await service.run(
      'job-1',
      { llm: { maxAttempts: 1 } } as unknown as SandboxJobParams,
      jest.fn().mockResolvedValue(undefined),
    );

    expect(outcome).toEqual({ ok: false, error: 'refactor produced no changes' });
  });
});
