import { JobStatus, MIGRATION_JOB_NAME, MIGRATION_JOB_OPTIONS } from '../common/constants';
import { ApiMigrationsService, priorityFor } from './api-migrations.service';

const SOON = new Date('2026-01-05T00:00:00Z');
const LATER = new Date('2026-06-30T00:00:00Z');

function impact(repositoryId: string, breakingChangeId: string, effectiveAt: Date | null = SOON) {
  return {
    repositoryId,
    breakingChangeId,
    repository: { fullName: `acme/${repositoryId}` },
    breakingChange: { effectiveAt },
  };
}

/** Enforces the (repository, change) unique index the way skipDuplicates relies on it. */
function setup(impacts: ReturnType<typeof impact>[], existing: Array<[string, string]> = []) {
  const jobs = existing.map(([repositoryId, breakingChangeId], index) => ({
    id: `old-${index}`,
    repositoryId,
    breakingChangeId,
  }));
  const prisma = {
    apiImpact: { findMany: jest.fn().mockResolvedValue(impacts) },
    migrationJob: {
      createManyAndReturn: jest.fn(
        (args: { data: Array<{ repositoryId: string; breakingChangeId: string }> }) => {
          const created: Array<{ id: string; repositoryId: string; breakingChangeId: string }> = [];
          for (const row of args.data) {
            if (
              jobs.some(
                (job) =>
                  job.repositoryId === row.repositoryId &&
                  job.breakingChangeId === row.breakingChangeId,
              )
            ) {
              continue;
            }
            const job = { id: `job-${jobs.length + 1}`, ...row };
            jobs.push(job);
            created.push({
              id: job.id,
              repositoryId: job.repositoryId,
              breakingChangeId: job.breakingChangeId,
            });
          }
          return Promise.resolve(created);
        },
      ),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const service = new ApiMigrationsService(prisma as never, queue as never);
  return { service, prisma, queue, jobs };
}

describe('ApiMigrationsService', () => {
  it('reads only confirmed impacts of confirmed changes that can be migrated, within the scope', async () => {
    const { service, prisma } = setup([]);

    await service.queueConfirmedImpacts({ repositoryId: 'repo-1' });
    await service.queueConfirmedImpacts({ changeId: 'change-1' });

    expect(
      prisma.apiImpact.findMany.mock.calls.map(([args]: [{ where: unknown }]) => args.where),
    ).toEqual([
      {
        confidence: 'confirmed',
        repositoryId: 'repo-1',
        breakingChange: { status: 'confirmed', kind: { not: 'behavior_changed' } },
      },
      {
        confidence: 'confirmed',
        breakingChangeId: 'change-1',
        breakingChange: { status: 'confirmed', kind: { not: 'behavior_changed' } },
      },
    ]);
    expect(prisma.migrationJob.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('creates one api_change job per impacted repository and queues it by its deadline', async () => {
    const { service, prisma, queue } = setup([
      impact('repo-1', 'change-1', LATER),
      impact('repo-2', 'change-1', SOON),
    ]);

    await service.queueConfirmedImpacts();

    expect(prisma.migrationJob.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          {
            repositoryId: 'repo-1',
            kind: 'api_change',
            breakingChangeId: 'change-1',
            status: JobStatus.QUEUED,
          },
          {
            repositoryId: 'repo-2',
            kind: 'api_change',
            breakingChangeId: 'change-1',
            status: JobStatus.QUEUED,
          },
        ],
        skipDuplicates: true,
      }),
    );
    expect(queue.add.mock.calls).toEqual([
      [
        MIGRATION_JOB_NAME,
        { jobId: 'job-1', repoUrl: 'https://github.com/acme/repo-1.git' },
        { ...MIGRATION_JOB_OPTIONS, priority: priorityFor(LATER) },
      ],
      [
        MIGRATION_JOB_NAME,
        { jobId: 'job-2', repoUrl: 'https://github.com/acme/repo-2.git' },
        { ...MIGRATION_JOB_OPTIONS, priority: priorityFor(SOON) },
      ],
    ]);
  });

  it('never queues a repository and change that already have a job, whatever its status', async () => {
    const { service, queue } = setup(
      [impact('repo-1', 'change-1'), impact('repo-2', 'change-1')],
      [['repo-1', 'change-1']],
    );

    await service.queueConfirmedImpacts();
    await service.queueConfirmedImpacts();

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      MIGRATION_JOB_NAME,
      { jobId: 'job-2', repoUrl: 'https://github.com/acme/repo-2.git' },
      expect.anything(),
    );
  });

  it('queues an undated change at the lowest priority BullMQ accepts', async () => {
    const { service, queue } = setup([impact('repo-1', 'change-1', null)]);

    await service.queueConfirmedImpacts();

    expect(queue.add).toHaveBeenCalledWith(
      MIGRATION_JOB_NAME,
      { jobId: 'job-1', repoUrl: 'https://github.com/acme/repo-1.git' },
      { ...MIGRATION_JOB_OPTIONS, priority: 2 ** 21 - 1 },
    );
  });

  it('marks a job it could not queue FAILED and still queues the rest', async () => {
    const { service, prisma, queue } = setup([
      impact('repo-1', 'change-1'),
      impact('repo-2', 'change-1'),
    ]);
    queue.add.mockRejectedValueOnce(new Error('redis down'));

    await service.queueConfirmedImpacts();

    expect(prisma.migrationJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: JobStatus.FAILED, errorMessage: 'Could not queue job: Error: redis down' },
    });
    expect(queue.add).toHaveBeenCalledTimes(2);
  });
});

describe('priorityFor', () => {
  it('runs a sooner deadline first and an undated change last', () => {
    expect(priorityFor(SOON)).toBeLessThan(priorityFor(LATER));
    expect(priorityFor(LATER)).toBeLessThan(priorityFor(null));
    expect(priorityFor(null)).toBe(2 ** 21 - 1);
  });

  it('stays inside the range BullMQ accepts', () => {
    expect(priorityFor(new Date(0))).toBe(1);
    expect(priorityFor(new Date('9999-12-31T00:00:00Z'))).toBe(2 ** 21 - 2);
  });
});
