import { Prisma } from '@prisma/client';
import { JobStatus, MIGRATION_JOB_NAME } from '../common/constants';
import { MigrationJobsService, type EnqueueMigrationInput } from './migration-jobs.service';

const INPUT: EnqueueMigrationInput = {
  githubRepoId: 42n,
  fullName: 'acme/widgets',
  installationId: 7n,
  repoUrl: 'https://github.com/acme/widgets.git',
  dependencyName: 'react',
  targetVersion: '19.0.0',
};

const RETRY_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 120_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('request failed', {
    code,
    clientVersion: 'test',
  });
}

/**
 * An in-memory stand-in for the two tables, enforcing the same unique
 * constraint the database does, so dedup is exercised rather than scripted.
 */
function setup() {
  const repositories = new Map<bigint, { id: string; fullName: string; installationId: bigint }>();
  const jobs: Array<{
    id: string;
    repositoryId: string;
    dependencyName: string;
    targetVersion: string;
    status: string;
    errorMessage: string | null;
  }> = [];

  const prisma = {
    repository: {
      upsert: jest.fn(
        (args: {
          where: { githubRepoId: bigint };
          create: { fullName: string; installationId: bigint };
          update: { fullName: string; installationId: bigint };
        }) => {
          const existing = repositories.get(args.where.githubRepoId);
          const row = existing
            ? { ...existing, ...args.update }
            : { id: `repo-${repositories.size + 1}`, ...args.create };
          repositories.set(args.where.githubRepoId, row);
          return Promise.resolve(row);
        },
      ),
    },
    migrationJob: {
      create: jest.fn(
        (args: {
          data: { repositoryId: string; dependencyName: string; targetVersion: string };
        }) => {
          const { repositoryId, dependencyName, targetVersion } = args.data;
          if (
            jobs.some(
              (job) =>
                job.repositoryId === repositoryId &&
                job.dependencyName === dependencyName &&
                job.targetVersion === targetVersion,
            )
          ) {
            return Promise.reject(knownError('P2002'));
          }
          const row = {
            id: `job-${jobs.length + 1}`,
            ...args.data,
            status: JobStatus.QUEUED,
            errorMessage: null,
          };
          jobs.push(row);
          return Promise.resolve(row);
        },
      ),
      findUniqueOrThrow: jest.fn(
        (args: {
          where:
            | { id: string }
            | {
                repositoryId_dependencyName_targetVersion: {
                  repositoryId: string;
                  dependencyName: string;
                  targetVersion: string;
                };
              };
        }) => {
          const where = args.where;
          const row =
            'id' in where
              ? jobs.find((job) => job.id === where.id)
              : jobs.find(
                  (job) =>
                    job.repositoryId ===
                      where.repositoryId_dependencyName_targetVersion.repositoryId &&
                    job.dependencyName ===
                      where.repositoryId_dependencyName_targetVersion.dependencyName &&
                    job.targetVersion ===
                      where.repositoryId_dependencyName_targetVersion.targetVersion,
                );
          // A copy, as Prisma returns: later writes must not show through it.
          return row ? Promise.resolve({ ...row }) : Promise.reject(knownError('P2025'));
        },
      ),
      // Conditional, like the database: only rows still matching the filter change.
      updateMany: jest.fn(
        (args: {
          where: { id: string; status: string };
          data: { status: string; errorMessage: string | null };
        }) => {
          const matching = jobs.filter(
            (job) => job.id === args.where.id && job.status === args.where.status,
          );
          for (const row of matching) {
            Object.assign(row, args.data);
          }
          return Promise.resolve({ count: matching.length });
        },
      ),
      update: jest.fn(
        (args: { where: { id: string }; data: { status: string; errorMessage: string } }) => {
          const row = jobs.find((job) => job.id === args.where.id);
          Object.assign(row!, args.data);
          return Promise.resolve(row);
        },
      ),
    },
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const service = new MigrationJobsService(queue as never, prisma as never);

  return { service, prisma, queue, repositories, jobs };
}

describe('MigrationJobsService.enqueue', () => {
  it('stores the repository and a QUEUED job, then queues it with retry options', async () => {
    const { service, queue, repositories, jobs } = setup();

    await expect(service.enqueue(INPUT)).resolves.toEqual({
      id: 'job-1',
      status: JobStatus.QUEUED,
      queued: true,
    });

    expect(repositories.get(42n)).toEqual({
      id: 'repo-1',
      githubRepoId: 42n,
      fullName: 'acme/widgets',
      installationId: 7n,
    });
    expect(jobs).toEqual([
      {
        id: 'job-1',
        repositoryId: 'repo-1',
        dependencyName: 'react',
        targetVersion: '19.0.0',
        status: JobStatus.QUEUED,
        errorMessage: null,
      },
    ]);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      MIGRATION_JOB_NAME,
      { jobId: 'job-1', repoUrl: 'https://github.com/acme/widgets.git' },
      RETRY_JOB_OPTIONS,
    );
  });

  it('refreshes a renamed or reinstalled repository without creating a second row', async () => {
    const { service, repositories } = setup();

    await service.enqueue(INPUT);
    await service.enqueue({
      ...INPUT,
      fullName: 'acme/gadgets',
      installationId: 8n,
      targetVersion: '19.1.0',
    });

    expect(repositories.size).toBe(1);
    expect(repositories.get(42n)).toMatchObject({
      id: 'repo-1',
      fullName: 'acme/gadgets',
      installationId: 8n,
    });
  });

  it('queues the same release once when it is triggered twice', async () => {
    const { service, queue, jobs } = setup();

    await service.enqueue(INPUT);
    await expect(service.enqueue(INPUT)).resolves.toEqual({
      id: 'job-1',
      status: JobStatus.QUEUED,
      queued: false,
    });

    expect(jobs).toHaveLength(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('treats a different version or dependency of the same repository as a new job', async () => {
    const { service, queue, jobs } = setup();

    await service.enqueue(INPUT);
    await service.enqueue({ ...INPUT, targetVersion: '19.1.0' });
    await service.enqueue({ ...INPUT, dependencyName: 'react-dom' });

    expect(jobs.map((job) => job.id)).toEqual(['job-1', 'job-2', 'job-3']);
    expect(queue.add).toHaveBeenCalledTimes(3);
  });

  it.each([JobStatus.IN_PROGRESS, JobStatus.COMPLETED])(
    'reports an existing %s job without queueing it again',
    async (status) => {
      const { service, queue, jobs } = setup();
      await service.enqueue(INPUT);
      jobs[0].status = status;

      await expect(service.enqueue(INPUT)).resolves.toEqual({
        id: 'job-1',
        status,
        queued: false,
      });
      expect(queue.add).toHaveBeenCalledTimes(1);
    },
  );

  it('queues an existing FAILED job again', async () => {
    const { service, queue, jobs } = setup();
    await service.enqueue(INPUT);
    jobs[0].status = JobStatus.FAILED;

    await expect(service.enqueue(INPUT)).resolves.toEqual({
      id: 'job-1',
      status: JobStatus.QUEUED,
      queued: true,
    });
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenLastCalledWith(
      MIGRATION_JOB_NAME,
      { jobId: 'job-1', repoUrl: 'https://github.com/acme/widgets.git' },
      RETRY_JOB_OPTIONS,
    );
  });

  it('queues a FAILED job once when it is retried twice before the worker runs', async () => {
    const { service, queue, jobs } = setup();
    await service.enqueue(INPUT);
    jobs[0].status = JobStatus.FAILED;
    jobs[0].errorMessage = 'tests failed';

    await expect(service.enqueue(INPUT)).resolves.toMatchObject({ queued: true });
    await expect(service.enqueue(INPUT)).resolves.toEqual({
      id: 'job-1',
      status: JobStatus.QUEUED,
      queued: false,
    });

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(jobs[0]).toMatchObject({ status: JobStatus.QUEUED, errorMessage: null });
  });

  it('queues a FAILED job once when two triggers race for it', async () => {
    const { service, queue, jobs } = setup();
    await service.enqueue(INPUT);
    jobs[0].status = JobStatus.FAILED;

    const results = await Promise.all([service.enqueue(INPUT), service.enqueue(INPUT)]);

    expect(results.filter((result) => result.queued)).toHaveLength(1);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('reports the current status when another trigger already took the retry', async () => {
    const { service, prisma, queue, jobs } = setup();
    await service.enqueue(INPUT);
    jobs[0].status = JobStatus.FAILED;
    // A worker claims the job between this trigger's read and its update.
    prisma.migrationJob.updateMany.mockImplementationOnce(() => {
      jobs[0].status = JobStatus.IN_PROGRESS;
      return Promise.resolve({ count: 0 });
    });

    await expect(service.enqueue(INPUT)).resolves.toEqual({
      id: 'job-1',
      status: JobStatus.IN_PROGRESS,
      queued: false,
    });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('marks the job FAILED when the queue rejects it, so a later trigger can retry', async () => {
    const { service, queue, jobs } = setup();
    queue.add.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:6379'));

    await expect(service.enqueue(INPUT)).rejects.toThrow('ECONNREFUSED');
    expect(jobs[0]).toMatchObject({
      status: JobStatus.FAILED,
      errorMessage: 'Could not queue job: Error: connect ECONNREFUSED 127.0.0.1:6379',
    });

    await expect(service.enqueue(INPUT)).resolves.toEqual({
      id: 'job-1',
      status: JobStatus.QUEUED,
      queued: true,
    });
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('rethrows a database error that is not a unique violation', async () => {
    const { service, prisma, queue } = setup();
    prisma.migrationJob.create.mockRejectedValueOnce(knownError('P2003'));

    await expect(service.enqueue(INPUT)).rejects.toMatchObject({ code: 'P2003' });
    expect(prisma.migrationJob.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('propagates a failed repository upsert without creating a job', async () => {
    const { service, prisma, queue } = setup();
    prisma.repository.upsert.mockRejectedValueOnce(new Error('connection lost'));

    await expect(service.enqueue(INPUT)).rejects.toThrow('connection lost');
    expect(prisma.migrationJob.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('propagates a duplicate whose row vanished before it could be read', async () => {
    const { service, prisma, queue } = setup();
    prisma.migrationJob.create.mockRejectedValueOnce(knownError('P2002'));

    await expect(service.enqueue(INPUT)).rejects.toMatchObject({ code: 'P2025' });
    expect(queue.add).not.toHaveBeenCalled();
  });
});

const CREATED = new Date('2026-10-15T10:00:00Z');

function setupDetail(job: unknown) {
  const prisma = { migrationJob: { findUnique: jest.fn().mockResolvedValue(job) } };
  const service = new MigrationJobsService({} as never, prisma as never);
  return { service, prisma };
}

describe('MigrationJobsService.findDetail', () => {
  it('reads the job with its repository and logs oldest first, and stringifies BigInt ids', async () => {
    const { service, prisma } = setupDetail({
      id: 'job-1',
      repositoryId: 'repo-1',
      dependencyName: 'react',
      targetVersion: '19.0.0',
      status: 'QUEUED',
      pullRequestUrl: null,
      errorMessage: null,
      createdAt: CREATED,
      updatedAt: CREATED,
      repository: {
        id: 'repo-1',
        githubRepoId: 9007199254740993n,
        fullName: 'acme/widgets',
        installationId: 7n,
        createdAt: CREATED,
      },
      executionLogs: [],
    });

    const detail = await service.findDetail('job-1');

    expect(prisma.migrationJob.findUnique).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      include: { repository: true, executionLogs: { orderBy: { createdAt: 'asc' } } },
    });
    expect(detail?.repository.githubRepoId).toBe('9007199254740993');
    expect(detail?.repository.installationId).toBe('7');
    expect(() => JSON.stringify(detail)).not.toThrow();
  });

  it('returns null for an unknown job', async () => {
    const { service } = setupDetail(null);

    await expect(service.findDetail('missing')).resolves.toBeNull();
  });
});
