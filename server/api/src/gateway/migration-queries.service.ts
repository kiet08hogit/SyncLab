import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JobStatus } from '../common/constants';
import type { Caller } from './api-auth.guard';

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 500;

// BigInt columns go out as strings: JSON.stringify cannot serialize a BigInt.
export interface RepositoryOut {
  id: string;
  githubRepoId: string;
  fullName: string;
  installationId: string;
  createdAt: Date;
}

/** What an api_change job migrates off, for the dashboard to name it. */
export interface MigrationChangeOut {
  id: string;
  provider: string;
  kind: string;
  operation: string | null;
  field: string | null;
  replacement: string | null;
  effectiveAt: Date | null;
}

export interface MigrationJobOut {
  id: string;
  repositoryId: string;
  /** dependency or api_change. */
  kind: string;
  /** Set for a dependency job only. */
  dependencyName: string | null;
  targetVersion: string | null;
  breakingChangeId: string | null;
  /** Set for an api_change job only. */
  breakingChange: MigrationChangeOut | null;
  status: string;
  pullRequestUrl: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  repository: RepositoryOut;
}

export interface MigrationJobSummary extends MigrationJobOut {
  /** Log steps reached so far, oldest first. Enough to draw the pipeline track. */
  steps: string[];
}

export interface MigrationJobDetail extends MigrationJobOut {
  executionLogs: Array<{
    id: string;
    jobId: string;
    step: string;
    output: string | null;
    createdAt: Date;
  }>;
}

export interface RepositorySummary {
  githubRepoId: string;
  fullName: string;
  installationId: string;
  /** Unknown for a service caller, which reads repositories from the database rather than GitHub. */
  private: boolean | null;
  jobCount: number;
  completed: number;
  failed: number;
  active: number;
  lastActivityAt: Date | null;
}

export interface JobFilter {
  status?: JobStatus;
  repoFullName?: string;
  query?: string;
  limit?: number;
}

const CHANGE_INCLUDE = {
  select: {
    id: true,
    kind: true,
    operation: true,
    field: true,
    replacement: true,
    effectiveAt: true,
    provider: { select: { slug: true } },
  },
} as const;

function changeOut(
  change: Prisma.BreakingChangeGetPayload<typeof CHANGE_INCLUDE> | null,
): MigrationChangeOut | null {
  if (!change) return null;
  const { provider, ...rest } = change;
  return { ...rest, provider: provider.slug };
}

function repositoryOut(repository: {
  id: string;
  githubRepoId: bigint;
  fullName: string;
  installationId: bigint;
  createdAt: Date;
}): RepositoryOut {
  return {
    ...repository,
    githubRepoId: repository.githubRepoId.toString(),
    installationId: repository.installationId.toString(),
  };
}

/**
 * Every read is scoped to the caller: a user only sees jobs on repositories
 * their GitHub installations reach, matched by GitHub's repository id so a
 * rename or transfer does not hide or expose anything.
 */
function scope(caller: Caller): Prisma.RepositoryWhereInput {
  return caller.kind === 'service' ? {} : { githubRepoId: { in: [...caller.repositories.keys()] } };
}

@Injectable()
export class MigrationQueriesService {
  constructor(private readonly prisma: PrismaService) {}

  async listJobs(caller: Caller, filter: JobFilter = {}): Promise<MigrationJobSummary[]> {
    const query = filter.query?.trim();
    const jobs = await this.prisma.migrationJob.findMany({
      where: {
        status: filter.status,
        repository: {
          ...scope(caller),
          ...(filter.repoFullName ? { fullName: filter.repoFullName } : {}),
        },
        ...(query
          ? {
              OR: [
                { dependencyName: { contains: query, mode: 'insensitive' } },
                { targetVersion: { contains: query, mode: 'insensitive' } },
                { breakingChange: { field: { contains: query, mode: 'insensitive' } } },
                { breakingChange: { operation: { contains: query, mode: 'insensitive' } } },
                { breakingChange: { kind: { contains: query, mode: 'insensitive' } } },
                {
                  breakingChange: {
                    kind: { contains: query.replaceAll(' ', '_'), mode: 'insensitive' },
                  },
                },
                { repository: { fullName: { contains: query, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        repository: true,
        breakingChange: CHANGE_INCLUDE,
        executionLogs: { select: { step: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
    });

    return jobs.map(({ executionLogs, repository, breakingChange, ...job }) => ({
      ...job,
      breakingChange: changeOut(breakingChange),
      repository: repositoryOut(repository),
      steps: executionLogs.map((log) => log.step),
    }));
  }

  async countByStatus(caller: Caller): Promise<Record<JobStatus, number>> {
    const groups = await this.prisma.migrationJob.groupBy({
      by: ['status'],
      where: { repository: scope(caller) },
      _count: { _all: true },
    });

    const counts: Record<JobStatus, number> = {
      QUEUED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      FAILED: 0,
    };
    for (const group of groups) {
      if (group.status in counts) {
        counts[group.status as JobStatus] = group._count._all;
      }
    }
    return counts;
  }

  async findDetail(caller: Caller, id: string): Promise<MigrationJobDetail | null> {
    const job = await this.prisma.migrationJob.findFirst({
      where: { id, repository: scope(caller) },
      include: {
        repository: true,
        breakingChange: CHANGE_INCLUDE,
        executionLogs: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!job) {
      return null;
    }

    return {
      ...job,
      breakingChange: changeOut(job.breakingChange),
      repository: repositoryOut(job.repository),
    };
  }

  /**
   * A user sees every repository their installations reach, including ones
   * that have no jobs yet. A service caller sees the repositories SyncLab has
   * recorded.
   */
  async listRepositories(caller: Caller): Promise<RepositorySummary[]> {
    const recorded = await this.prisma.repository.findMany({ where: scope(caller) });
    const stats = await this.statsByRepository(recorded.map((repository) => repository.id));
    const recordedByGithubId = new Map(
      recorded.map((repository) => [repository.githubRepoId, repository]),
    );

    const base: Array<{
      githubRepoId: bigint;
      fullName: string;
      installationId: bigint;
      private: boolean | null;
    }> =
      caller.kind === 'service'
        ? recorded.map((repository) => ({
            githubRepoId: repository.githubRepoId,
            fullName: repository.fullName,
            installationId: repository.installationId,
            private: null,
          }))
        : [...caller.repositories.values()];

    return base
      .map((repository) => {
        const row = recordedByGithubId.get(repository.githubRepoId);
        const counts = (row && stats.get(row.id)) ?? {
          jobCount: 0,
          completed: 0,
          failed: 0,
          active: 0,
          lastActivityAt: null,
        };
        return {
          githubRepoId: repository.githubRepoId.toString(),
          fullName: repository.fullName,
          installationId: repository.installationId.toString(),
          private: repository.private,
          ...counts,
        };
      })
      .sort(
        (a, b) =>
          (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0) ||
          a.fullName.localeCompare(b.fullName),
      );
  }

  private async statsByRepository(repositoryIds: string[]) {
    const stats = new Map<
      string,
      {
        jobCount: number;
        completed: number;
        failed: number;
        active: number;
        lastActivityAt: Date | null;
      }
    >();
    if (repositoryIds.length === 0) {
      return stats;
    }

    const groups = await this.prisma.migrationJob.groupBy({
      by: ['repositoryId', 'status'],
      where: { repositoryId: { in: repositoryIds } },
      _count: { _all: true },
      _max: { updatedAt: true },
    });

    for (const group of groups) {
      const entry = stats.get(group.repositoryId) ?? {
        jobCount: 0,
        completed: 0,
        failed: 0,
        active: 0,
        lastActivityAt: null,
      };
      const count = group._count._all;
      entry.jobCount += count;
      if (group.status === JobStatus.COMPLETED) entry.completed += count;
      if (group.status === JobStatus.FAILED) entry.failed += count;
      if (group.status === JobStatus.QUEUED || group.status === JobStatus.IN_PROGRESS) {
        entry.active += count;
      }
      const updated = group._max.updatedAt;
      if (updated && (!entry.lastActivityAt || updated > entry.lastActivityAt)) {
        entry.lastActivityAt = updated;
      }
      stats.set(group.repositoryId, entry);
    }
    return stats;
  }
}
