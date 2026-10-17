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
    apiUsage: { createMany: jest.fn((args: unknown) => ({ op: 'createMany', args })) },
    $transaction: jest.fn().mockResolvedValue(undefined),
  };
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
  const processor = new ScanProcessor(prisma as never, sandbox as never, githubToken as never);
  const job = { data: { scanId: 'scan-1', repoUrl: 'https://github.com/acme/api.git' } };
  return { processor, prisma, sandbox, githubToken, job };
}

describe('ScanProcessor', () => {
  it('starts the scan, frees the waiting slot, and stores the usages with the commit in one transaction', async () => {
    const { processor, prisma, sandbox, githubToken, job } = setup();

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
    expect(prisma.$transaction).toHaveBeenCalledWith([
      {
        op: 'createMany',
        args: {
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
        },
      },
      {
        op: 'update',
        args: {
          where: { id: 'scan-1' },
          data: {
            status: JobStatus.COMPLETED,
            commitSha: 'c'.repeat(40),
            output: '[SCAN]\nfound 1',
            errorMessage: null,
          },
        },
      },
    ]);
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
