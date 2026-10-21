import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  BreakingChangeStatus,
  JobStatus,
  MIGRATION_JOB_NAME,
  MIGRATION_JOB_OPTIONS,
  MIGRATION_QUEUE,
  MigrationKind,
  REPORTED_ONLY_KIND,
  type MigrationJobData,
} from '../common/constants';
import { ImpactConfidence } from './match';

const DAY_MS = 24 * 60 * 60 * 1000;
// BullMQ's lowest priority. A job with no priority at all, such as a
// dependency migration, is taken before any prioritized one.
const MAX_PRIORITY = 2 ** 21;

/** The sooner a change takes effect, the sooner its migrations run. Undated changes go last. */
export function priorityFor(effectiveAt: Date | null): number {
  if (!effectiveAt) {
    return MAX_PRIORITY;
  }
  return Math.min(Math.max(Math.floor(effectiveAt.getTime() / DAY_MS), 1), MAX_PRIORITY - 1);
}

export interface MigrationScope {
  repositoryId?: string;
  changeId?: string;
}

/**
 * Turns confirmed impacts into api_change migration jobs. Only a repository
 * and change with no job yet gets one, so recomputing impacts again (on every
 * scan, poll and worker start) never replays a migration that already ran or
 * failed and spends the model quota on it again.
 */
@Injectable()
export class ApiMigrationsService {
  private readonly logger = new Logger(ApiMigrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(MIGRATION_QUEUE) private readonly queue: Queue,
  ) {}

  async queueConfirmedImpacts(scope: MigrationScope = {}): Promise<void> {
    const impacts = await this.prisma.apiImpact.findMany({
      where: {
        confidence: ImpactConfidence.CONFIRMED,
        ...(scope.repositoryId ? { repositoryId: scope.repositoryId } : {}),
        ...(scope.changeId ? { breakingChangeId: scope.changeId } : {}),
        breakingChange: {
          status: BreakingChangeStatus.CONFIRMED,
          kind: { not: REPORTED_ONLY_KIND },
        },
      },
      select: {
        repositoryId: true,
        breakingChangeId: true,
        repository: { select: { fullName: true } },
        breakingChange: { select: { effectiveAt: true } },
      },
    });
    if (impacts.length === 0) {
      return;
    }

    // The unique index on (repository, change) makes this safe against a
    // concurrent recompute: only one of them creates each row.
    const created = await this.prisma.migrationJob.createManyAndReturn({
      data: impacts.map((impact) => ({
        repositoryId: impact.repositoryId,
        kind: MigrationKind.API_CHANGE,
        breakingChangeId: impact.breakingChangeId,
        status: JobStatus.QUEUED,
      })),
      skipDuplicates: true,
      select: { id: true, repositoryId: true, breakingChangeId: true },
    });

    for (const job of created) {
      const impact = impacts.find(
        (candidate) =>
          candidate.repositoryId === job.repositoryId &&
          candidate.breakingChangeId === job.breakingChangeId,
      );
      if (!impact) continue;
      await this.enqueue(job.id, impact.repository.fullName, impact.breakingChange.effectiveAt);
    }
  }

  private async enqueue(jobId: string, fullName: string, effectiveAt: Date | null): Promise<void> {
    const data: MigrationJobData = { jobId, repoUrl: `https://github.com/${fullName}.git` };

    try {
      await this.queue.add(MIGRATION_JOB_NAME, data, {
        ...MIGRATION_JOB_OPTIONS,
        priority: priorityFor(effectiveAt),
      });
    } catch (error: unknown) {
      // A row left QUEUED with nothing in the queue would never run, so mark
      // it FAILED where the dashboard shows it.
      this.logger.error(`Could not queue migration ${jobId}: ${String(error)}`);
      await this.prisma.migrationJob.update({
        where: { id: jobId },
        data: { status: JobStatus.FAILED, errorMessage: `Could not queue job: ${String(error)}` },
      });
    }
  }
}
