import { JobStatus } from '../common/constants';
import { claimMigrationJob } from './claim-job';

function mockPrisma(
  locked: Array<{ status: string; pull_request_url: string | null }>,
  record?: unknown,
) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue(locked),
    migrationJob: {
      update: jest.fn().mockResolvedValue(undefined),
      findUniqueOrThrow: jest.fn().mockResolvedValue(record),
    },
  };

  return {
    prisma: {
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    } as never,
    tx,
  };
}

describe('claimMigrationJob', () => {
  it('skips a job that already completed so a retry cannot open a second PR', async () => {
    const { prisma, tx } = mockPrisma([
      { status: JobStatus.COMPLETED, pull_request_url: 'https://github.com/acme/widgets/pull/1' },
    ]);

    await expect(claimMigrationJob(prisma, 'job-1')).resolves.toEqual({
      kind: 'skipped',
      pullRequestUrl: 'https://github.com/acme/widgets/pull/1',
    });
    expect(tx.migrationJob.update).not.toHaveBeenCalled();
  });

  it('locks a queued job and marks it in progress', async () => {
    const record = {
      id: 'job-1',
      status: JobStatus.IN_PROGRESS,
      repository: { fullName: 'acme/widgets' },
    };
    const { prisma, tx } = mockPrisma([{ status: JobStatus.QUEUED, pull_request_url: null }], record);

    await expect(claimMigrationJob(prisma, 'job-1')).resolves.toEqual({
      kind: 'claimed',
      record,
    });
    expect(tx.migrationJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: JobStatus.IN_PROGRESS, errorMessage: null },
    });
  });

  it('throws when the row disappeared between dequeue and claim', async () => {
    const { prisma } = mockPrisma([]);

    await expect(claimMigrationJob(prisma, 'missing')).rejects.toThrow(
      'MigrationJob missing no longer exists',
    );
  });
});
