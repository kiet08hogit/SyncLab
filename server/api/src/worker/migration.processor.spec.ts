import { UnrecoverableError } from 'bullmq';
import { JobStatus } from '../common/constants';
import { claimMigrationJob } from './claim-job';
import { MigrationProcessor } from './migration.processor';

jest.mock('./claim-job');

describe('MigrationProcessor', () => {
  it('takes its concurrency from configuration().worker.concurrency', () => {
    jest.isolateModules(() => {
      jest.doMock('../config/configuration', () => ({
        ...jest.requireActual<object>('../config/configuration'),
        configuration: () => ({ worker: { concurrency: 7 } }),
      }));

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require('./migration.processor') as { MigrationProcessor: object };
      expect(Reflect.getMetadata('bullmq:worker_metadata', fresh.MigrationProcessor)).toEqual({
        concurrency: 7,
      });
    });
  });

  it('fails without retry when the refactor produced no changes', async () => {
    jest.mocked(claimMigrationJob).mockResolvedValue({
      kind: 'claimed',
      record: {
        dependencyName: 'widgets',
        targetVersion: 'v2.0.0',
        repository: { fullName: 'acme/widgets', installationId: 1n },
      },
    } as never);

    const prisma = {
      migrationJob: { update: jest.fn().mockResolvedValue(undefined) },
      executionLog: { createMany: jest.fn().mockResolvedValue(undefined) },
    };
    const sandbox = {
      ensureImage: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue({ ok: false, error: 'refactor produced no changes' }),
    };
    const githubToken = { getInstallationToken: jest.fn().mockResolvedValue('token') };
    const config = { get: jest.fn().mockReturnValue({ apiKey: 'key', maxAttempts: 1 }) };

    const processor = new MigrationProcessor(
      prisma as never,
      sandbox as never,
      githubToken as never,
      config as never,
    );

    await expect(
      processor.process({ data: { jobId: 'job-1', repoUrl: '' } } as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(prisma.migrationJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: JobStatus.FAILED, errorMessage: 'refactor produced no changes' },
    });
    const statuses = prisma.migrationJob.update.mock.calls.map(
      ([args]: [{ data: { status: string } }]) => args.data.status,
    );
    expect(statuses).not.toContain(JobStatus.COMPLETED);
  });

  describe('a retryable sandbox failure', () => {
    function processorFailingWith(error: string) {
      jest.mocked(claimMigrationJob).mockResolvedValue({
        kind: 'claimed',
        record: {
          dependencyName: 'widgets',
          targetVersion: 'v2.0.0',
          repository: { fullName: 'acme/widgets', installationId: 1n },
        },
      } as never);

      const prisma = {
        migrationJob: { update: jest.fn().mockResolvedValue(undefined) },
        executionLog: { createMany: jest.fn().mockResolvedValue(undefined) },
      };
      const sandbox = {
        ensureImage: jest.fn().mockResolvedValue(undefined),
        run: jest.fn().mockResolvedValue({ ok: false, error, retryable: true }),
      };
      const githubToken = { getInstallationToken: jest.fn().mockResolvedValue('token') };
      const config = { get: jest.fn().mockReturnValue({ apiKey: 'key', maxAttempts: 1 }) };
      const processor = new MigrationProcessor(
        prisma as never,
        sandbox as never,
        githubToken as never,
        config as never,
      );

      return { processor, prisma };
    }

    function attempt(attemptsMade: number) {
      return {
        data: { jobId: 'job-1', repoUrl: '' },
        attemptsMade,
        opts: { attempts: 3 },
      } as never;
    }

    it('keeps the job QUEUED while BullMQ still has attempts left', async () => {
      const { processor, prisma } = processorFailingWith('model rate limited');

      await expect(processor.process(attempt(0))).rejects.not.toBeInstanceOf(UnrecoverableError);

      // FAILED here would let a trigger during the backoff queue a second run.
      expect(prisma.migrationJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: JobStatus.QUEUED, errorMessage: 'model rate limited' },
      });
    });

    it('marks the job FAILED on the last attempt', async () => {
      const { processor, prisma } = processorFailingWith('model rate limited');

      await expect(processor.process(attempt(2))).rejects.toThrow('model rate limited');

      expect(prisma.migrationJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: JobStatus.FAILED, errorMessage: 'model rate limited' },
      });
    });
  });
});
