import { JobStatus } from '../common/constants';
import { ScanProcessor } from './scan.processor';

const USAGE = {
  provider: 'anthropic' as const,
  file: 'src/llm/chain.ts',
  line: 4,
  style: 'sdk' as const,
  method: 'beta.messages.stream',
  operation: 'POST /v1/messages',
  params: ['model'],
  modelIds: [],
  dynamic: true,
};

function setup(claimed = 1) {
  const prisma = {
    repositoryScan: {
      updateMany: jest.fn().mockResolvedValue({ count: claimed }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'scan-1',
        repositoryId: 'repo-1',
        createdAt: new Date('2026-10-16T12:00:00Z'),
        repository: { installationId: 42n, fullName: 'acme/api' },
      }),
      update: jest.fn((args: unknown) => ({ op: 'update', args })),
    },
    apiProvider: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'p-anthropic', slug: 'anthropic' },
        { id: 'p-openai', slug: 'openai' },
      ]),
    },
    apiUsage: {
      deleteMany: jest.fn((args: unknown) => ({ op: 'deleteMany', args })),
      createMany: jest.fn((args: unknown) => ({ op: 'createMany', args })),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<void>) =>
    fn(prisma),
  );
  const sandbox = {
    ensureImage: jest.fn().mockResolvedValue(undefined),
    scan: jest.fn().mockResolvedValue({
      ok: true,
      commitSha: 'c'.repeat(40),
      usages: [USAGE],
      output: '[SCAN]\nfound 1',
    }),
  };
  const githubToken = { getInstallationToken: jest.fn().mockResolvedValue('ghs_token') };
  const impact = { recomputeRepository: jest.fn().mockResolvedValue(undefined) };
  const migrations = { queueConfirmedImpacts: jest.fn().mockResolvedValue(undefined) };
  const processor = new ScanProcessor(
    prisma as never,
    sandbox as never,
    githubToken as never,
    impact as never,
    migrations as never,
  );
  const job = { data: { scanId: 'scan-1', repoUrl: 'https://github.com/acme/api.git' } };
  return { processor, prisma, sandbox, githubToken, impact, migrations, job };
}

describe('ScanProcessor', () => {
  it('starts the scan, frees the waiting slot, and replaces older usages with its own and the commit in one transaction', async () => {
    const { processor, prisma, sandbox, githubToken, impact, job } = setup();

    await processor.process(job as never);

    expect(prisma.repositoryScan.updateMany).toHaveBeenCalledWith({
      where: { id: 'scan-1', status: { in: [JobStatus.QUEUED, JobStatus.IN_PROGRESS] } },
      data: { status: JobStatus.IN_PROGRESS, queuedFor: null },
    });
    expect(githubToken.getInstallationToken).toHaveBeenCalledWith(42n);
    expect(sandbox.scan).toHaveBeenCalledWith('scan-1', {
      repoUrl: 'https://github.com/acme/api.git',
      token: 'ghs_token',
    });
    expect(prisma.apiUsage.deleteMany).toHaveBeenCalledWith({
      where: {
        scan: {
          repositoryId: 'repo-1',
          status: JobStatus.COMPLETED,
          id: { not: 'scan-1' },
          createdAt: { lt: new Date('2026-10-16T12:00:00Z') },
        },
      },
    });
    expect(prisma.apiUsage.createMany).toHaveBeenCalledWith({
      data: [
        {
          scanId: 'scan-1',
          providerId: 'p-anthropic',
          file: 'src/llm/chain.ts',
          line: 4,
          style: 'sdk',
          method: 'beta.messages.stream',
          operation: 'POST /v1/messages',
          params: ['model'],
          modelIds: [],
          dynamic: true,
        },
      ],
    });
    expect(prisma.repositoryScan.update).toHaveBeenCalledWith({
      where: { id: 'scan-1' },
      data: {
        status: JobStatus.COMPLETED,
        commitSha: 'c'.repeat(40),
        output: '[SCAN]\nfound 1',
        errorMessage: null,
      },
    });
    expect(impact.recomputeRepository).toHaveBeenCalledWith('repo-1', prisma);
  });

  it('queues API migrations for the repository only after the scan has committed', async () => {
    const { processor, prisma, migrations, job } = setup();
    let committed = false;
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<void>) => {
      await fn(prisma);
      committed = true;
    });
    migrations.queueConfirmedImpacts.mockImplementation(() => {
      expect(committed).toBe(true);
      return Promise.resolve();
    });

    await processor.process(job as never);

    expect(migrations.queueConfirmedImpacts).toHaveBeenCalledWith({ repositoryId: 'repo-1' });
  });

  it('keeps the scan completed when queueing its migrations fails', async () => {
    const { processor, prisma, migrations, job } = setup();
    migrations.queueConfirmedImpacts.mockRejectedValue(new Error('redis down'));

    await expect(processor.process(job as never)).resolves.toBeUndefined();

    const statuses = prisma.repositoryScan.update.mock.calls.map(
      ([args]) => (args as { data: { status: string } }).data.status,
    );
    expect(statuses).toEqual([JobStatus.COMPLETED]);
  });

  it('leaves a scan that already finished alone, so a redelivered job does nothing', async () => {
    const { processor, sandbox, job } = setup(0);

    await processor.process(job as never);

    expect(sandbox.scan).not.toHaveBeenCalled();
  });

  it('marks the scan failed with the sandbox log, without throwing for BullMQ to retry', async () => {
    const { processor, prisma, sandbox, job } = setup();
    sandbox.scan.mockResolvedValue({
      ok: false,
      error: 'git clone failed',
      usages: [],
      output: '[CLONE]\nfatal: repository not found',
    });

    await expect(processor.process(job as never)).resolves.toBeUndefined();

    expect(prisma.repositoryScan.update).toHaveBeenCalledWith({
      where: { id: 'scan-1' },
      data: {
        status: JobStatus.FAILED,
        errorMessage: 'git clone failed',
        output: '[CLONE]\nfatal: repository not found',
        commitSha: null,
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('records an unexpected error and still lets it reach BullMQ', async () => {
    const { processor, prisma, githubToken, job } = setup();
    githubToken.getInstallationToken.mockRejectedValue(new Error('installation suspended'));

    await expect(processor.process(job as never)).rejects.toThrow('installation suspended');
    expect(prisma.repositoryScan.update).toHaveBeenCalledWith({
      where: { id: 'scan-1' },
      data: {
        status: JobStatus.FAILED,
        errorMessage: 'installation suspended',
        output: null,
        commitSha: null,
      },
    });
  });
});
