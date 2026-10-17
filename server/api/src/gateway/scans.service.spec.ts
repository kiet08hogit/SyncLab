import { Prisma } from '@prisma/client';
import { JobStatus, SCAN_JOB_NAME, ScanTrigger } from '../common/constants';
import { ScansService } from './scans.service';

const INPUT = {
  githubRepoId: 7n,
  fullName: 'acme/api',
  installationId: 42n,
  repoUrl: 'https://github.com/acme/api.git',
  trigger: ScanTrigger.PUSH,
};

function duplicateError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function setup() {
  const prisma = {
    repository: {
      upsert: jest.fn().mockResolvedValue({ id: 'repo-1' }),
      findUnique: jest.fn(),
    },
    repositoryScan: {
      create: jest.fn().mockResolvedValue({ id: 'scan-1', status: JobStatus.QUEUED }),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  return { service: new ScansService(queue as never, prisma as never), prisma, queue };
}

describe('ScansService.enqueue', () => {
  it('records the repository, holds its waiting slot, and queues one scan', async () => {
    const { service, prisma, queue } = setup();

    await expect(service.enqueue(INPUT)).resolves.toEqual({
      id: 'scan-1',
      status: JobStatus.QUEUED,
      queued: true,
    });

    expect(prisma.repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { githubRepoId: 7n } }),
    );
    expect(prisma.repositoryScan.create).toHaveBeenCalledWith({
      data: {
        repositoryId: 'repo-1',
        trigger: ScanTrigger.PUSH,
        status: JobStatus.QUEUED,
        queuedFor: 'repo-1',
      },
    });
    expect(queue.add).toHaveBeenCalledWith(
      SCAN_JOB_NAME,
      { scanId: 'scan-1', repoUrl: INPUT.repoUrl },
      expect.objectContaining({ attempts: 1 }),
    );
  });

  it('shares a scan that is still waiting instead of queueing another', async () => {
    const { service, prisma, queue } = setup();
    prisma.repositoryScan.create.mockRejectedValue(duplicateError());
    prisma.repositoryScan.findUnique.mockResolvedValue({ id: 'scan-0', status: JobStatus.QUEUED });

    await expect(service.enqueue(INPUT)).resolves.toEqual({
      id: 'scan-0',
      status: JobStatus.QUEUED,
      queued: false,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('queues a fresh scan when the waiting one starts between the two queries', async () => {
    const { service, prisma, queue } = setup();
    prisma.repositoryScan.create
      .mockRejectedValueOnce(duplicateError())
      .mockResolvedValueOnce({ id: 'scan-2', status: JobStatus.QUEUED });
    prisma.repositoryScan.findUnique.mockResolvedValue(null);

    await expect(service.enqueue(INPUT)).resolves.toMatchObject({ id: 'scan-2', queued: true });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('gives up rather than looping when the slot keeps changing hands', async () => {
    const { service, prisma } = setup();
    prisma.repositoryScan.create.mockRejectedValue(duplicateError());
    prisma.repositoryScan.findUnique.mockResolvedValue(null);

    await expect(service.enqueue(INPUT)).rejects.toThrow('Unique constraint failed');
    expect(prisma.repositoryScan.create).toHaveBeenCalledTimes(3);
  });

  it('frees the waiting slot when the queue is unreachable, so later triggers are not absorbed', async () => {
    const { service, prisma, queue } = setup();
    queue.add.mockRejectedValue(new Error('redis down'));

    await expect(service.enqueue(INPUT)).rejects.toThrow('redis down');
    expect(prisma.repositoryScan.update).toHaveBeenCalledWith({
      where: { id: 'scan-1' },
      data: {
        status: JobStatus.FAILED,
        queuedFor: null,
        errorMessage: 'Could not queue scan: Error: redis down',
      },
    });
  });
});

describe('ScansService.usageFor', () => {
  const scan = (id: string, status: string) => ({
    id,
    trigger: ScanTrigger.PUSH,
    status,
    commitSha: 'c'.repeat(40),
    errorMessage: null,
    queuedFor: null,
    output: 'log',
    repositoryId: 'repo-1',
    createdAt: new Date('2026-10-16T00:00:00Z'),
    updatedAt: new Date('2026-10-16T00:01:00Z'),
  });

  it('returns the usages of the newest completed scan, next to the newest scan of any status', async () => {
    const { service, prisma } = setup();
    prisma.repository.findUnique.mockResolvedValue({ id: 'repo-1', fullName: 'acme/api' });
    prisma.repositoryScan.findFirst
      .mockResolvedValueOnce(scan('scan-2', JobStatus.FAILED))
      .mockResolvedValueOnce({
        ...scan('scan-1', JobStatus.COMPLETED),
        usages: [
          {
            provider: { slug: 'anthropic' },
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

    const usage = await service.usageFor(7n);

    expect(usage?.latestScan).toMatchObject({ id: 'scan-2', status: JobStatus.FAILED });
    expect(usage?.usageScan).toMatchObject({ id: 'scan-1', status: JobStatus.COMPLETED });
    expect(usage?.usageScan).not.toHaveProperty('output');
    expect(usage?.usages).toEqual([
      {
        provider: 'anthropic',
        file: 'src/llm/chain.ts',
        line: 4,
        style: 'sdk',
        method: 'beta.messages.stream',
        operation: 'POST /v1/messages',
        params: ['model'],
        modelIds: [],
        dynamic: true,
      },
    ]);
  });

  it('is undefined for a repository SyncLab never recorded', async () => {
    const { service, prisma } = setup();
    prisma.repository.findUnique.mockResolvedValue(null);

    await expect(service.usageFor(7n)).resolves.toBeUndefined();
  });
});
