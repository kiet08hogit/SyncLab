import type { Caller } from './api-auth.guard';
import { MigrationQueriesService } from './migration-queries.service';

const AT = new Date('2026-10-15T10:00:00Z');
const LATER = new Date('2026-10-15T12:00:00Z');

const SERVICE: Caller = { kind: 'service' };
const USER: Caller = {
  kind: 'user',
  login: 'octocat',
  repositories: new Map([
    [42n, { githubRepoId: 42n, fullName: 'acme/widgets', installationId: 7n, private: true }],
    [43n, { githubRepoId: 43n, fullName: 'acme/new', installationId: 7n, private: false }],
  ]),
};

const REPO_ROW = {
  id: 'repo-1',
  githubRepoId: 42n,
  fullName: 'acme/widgets',
  installationId: 7n,
  createdAt: AT,
};

function setup() {
  const prisma = {
    migrationJob: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    repository: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, queries: new MigrationQueriesService(prisma as never) };
}

describe('MigrationQueriesService', () => {
  it('limits a user to repositories their installations reach, by GitHub id', async () => {
    const { prisma, queries } = setup();

    await queries.listJobs(USER, { status: 'FAILED', repoFullName: 'acme/widgets', query: 'zod' });

    expect(prisma.migrationJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'FAILED',
          repository: { githubRepoId: { in: [42n, 43n] }, fullName: 'acme/widgets' },
          OR: [
            { dependencyName: { contains: 'zod', mode: 'insensitive' } },
            { targetVersion: { contains: 'zod', mode: 'insensitive' } },
            { breakingChange: { field: { contains: 'zod', mode: 'insensitive' } } },
            { breakingChange: { operation: { contains: 'zod', mode: 'insensitive' } } },
            { repository: { fullName: { contains: 'zod', mode: 'insensitive' } } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  });

  it('names the change an api_change job migrates off, by provider slug', async () => {
    const { prisma, queries } = setup();
    const effectiveAt = new Date('2026-01-05T00:00:00Z');
    prisma.migrationJob.findMany.mockResolvedValue([
      {
        id: 'job-2',
        repositoryId: 'repo-1',
        kind: 'api_change',
        dependencyName: null,
        targetVersion: null,
        breakingChangeId: 'change-1',
        status: 'QUEUED',
        pullRequestUrl: null,
        errorMessage: null,
        createdAt: AT,
        updatedAt: AT,
        repository: REPO_ROW,
        breakingChange: {
          id: 'change-1',
          kind: 'model_retired',
          operation: 'POST /v1/messages',
          field: 'claude-3-opus-20240229',
          replacement: 'claude-opus-4-1',
          effectiveAt,
          provider: { slug: 'anthropic' },
        },
        executionLogs: [],
      },
    ]);

    const [job] = await queries.listJobs(USER);

    expect(job.breakingChange).toEqual({
      id: 'change-1',
      provider: 'anthropic',
      kind: 'model_retired',
      operation: 'POST /v1/messages',
      field: 'claude-3-opus-20240229',
      replacement: 'claude-opus-4-1',
      effectiveAt,
    });
  });

  it('does not limit a service caller', async () => {
    const { prisma, queries } = setup();

    await queries.listJobs(SERVICE);

    expect(prisma.migrationJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: undefined, repository: {} } }),
    );
  });

  it('shapes jobs with stringified ids and the steps reached', async () => {
    const { prisma, queries } = setup();
    prisma.migrationJob.findMany.mockResolvedValue([
      {
        id: 'job-1',
        repositoryId: 'repo-1',
        dependencyName: 'zod',
        targetVersion: '4.0.0',
        status: 'IN_PROGRESS',
        pullRequestUrl: null,
        errorMessage: null,
        createdAt: AT,
        updatedAt: AT,
        repository: REPO_ROW,
        executionLogs: [{ step: 'STARTED' }, { step: 'CLONE' }],
      },
    ]);

    const [job] = await queries.listJobs(USER);

    expect(job.breakingChange).toBeNull();
    expect(job.steps).toEqual(['STARTED', 'CLONE']);
    expect(job.repository.githubRepoId).toBe('42');
    expect(job).not.toHaveProperty('executionLogs');
    expect(() => JSON.stringify(job)).not.toThrow();
  });

  it('counts every status, including ones with no jobs', async () => {
    const { prisma, queries } = setup();
    prisma.migrationJob.groupBy.mockResolvedValue([
      { status: 'FAILED', _count: { _all: 2 } },
      { status: 'COMPLETED', _count: { _all: 5 } },
    ]);

    await expect(queries.countByStatus(USER)).resolves.toEqual({
      QUEUED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 5,
      FAILED: 2,
    });
    expect(prisma.migrationJob.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { repository: { githubRepoId: { in: [42n, 43n] } } } }),
    );
  });

  it('finds a job only inside the caller scope', async () => {
    const { prisma, queries } = setup();

    await expect(queries.findDetail(USER, 'job-1')).resolves.toBeNull();
    expect(prisma.migrationJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1', repository: { githubRepoId: { in: [42n, 43n] } } },
      }),
    );
  });

  it('lists every repository a user can reach, with job stats where SyncLab has any', async () => {
    const { prisma, queries } = setup();
    prisma.repository.findMany.mockResolvedValue([REPO_ROW]);
    prisma.migrationJob.groupBy.mockResolvedValue([
      { repositoryId: 'repo-1', status: 'COMPLETED', _count: { _all: 3 }, _max: { updatedAt: AT } },
      { repositoryId: 'repo-1', status: 'QUEUED', _count: { _all: 1 }, _max: { updatedAt: LATER } },
    ]);

    const repositories = await queries.listRepositories(USER);

    expect(repositories).toEqual([
      {
        githubRepoId: '42',
        fullName: 'acme/widgets',
        installationId: '7',
        private: true,
        jobCount: 4,
        completed: 3,
        failed: 0,
        active: 1,
        lastActivityAt: LATER,
      },
      {
        githubRepoId: '43',
        fullName: 'acme/new',
        installationId: '7',
        private: false,
        jobCount: 0,
        completed: 0,
        failed: 0,
        active: 0,
        lastActivityAt: null,
      },
    ]);
  });

  it('lists recorded repositories for a service caller', async () => {
    const { prisma, queries } = setup();
    prisma.repository.findMany.mockResolvedValue([REPO_ROW]);

    const repositories = await queries.listRepositories(SERVICE);

    expect(prisma.repository.findMany).toHaveBeenCalledWith({ where: {} });
    expect(repositories).toMatchObject([{ fullName: 'acme/widgets', private: null, jobCount: 0 }]);
  });
});
