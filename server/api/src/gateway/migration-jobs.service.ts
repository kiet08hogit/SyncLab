import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  JobStatus,
  MIGRATION_JOB_NAME,
  MIGRATION_QUEUE,
  type MigrationJobData,
} from '../common/constants';

const RETRY_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 120_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export interface EnqueueMigrationInput {
  githubRepoId: bigint;
  fullName: string;
  installationId: bigint;
  repoUrl: string;
  dependencyName: string;
  targetVersion: string;
}

export interface EnqueueMigrationResult {
  id: string;
  status: string;
  queued: boolean;
}

export interface MigrationJobDetail {
  id: string;
  repositoryId: string;
  dependencyName: string;
  targetVersion: string;
  status: string;
  pullRequestUrl: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  // BigInt columns go out as strings: JSON.stringify cannot serialize a BigInt.
  repository: {
    id: string;
    githubRepoId: string;
    fullName: string;
    installationId: string;
    createdAt: Date;
  };
  executionLogs: Array<{
    id: string;
    jobId: string;
    step: string;
    output: string | null;
    createdAt: Date;
  }>;
}

/**
 * Shared by the release webhook and the manual trigger, so both deduplicate
 * and retry a migration the same way.
 */
@Injectable()
export class MigrationJobsService {
  private readonly logger = new Logger(MigrationJobsService.name);

  constructor(
    @InjectQueue(MIGRATION_QUEUE) private readonly migrationQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async enqueue(input: EnqueueMigrationInput): Promise<EnqueueMigrationResult> {
    const repo = await this.prisma.repository.upsert({
      where: { githubRepoId: input.githubRepoId },
      create: {
        githubRepoId: input.githubRepoId,
        fullName: input.fullName,
        installationId: input.installationId,
      },
      update: {
        fullName: input.fullName,
        installationId: input.installationId,
      },
    });

    const { job, isNew } = await this.findOrCreateJob(
      repo.id,
      input.dependencyName,
      input.targetVersion,
    );

    // A redelivered webhook must not open a second pull request, but a job that
    // previously failed is worth another attempt.
    if (!isNew && job.status !== JobStatus.FAILED) {
      this.logger.log(`Job ${job.id} is already ${job.status}, not re-queueing`);
      return { id: job.id, status: job.status, queued: false };
    }

    // Moving FAILED back to QUEUED is the claim on the retry. Only the trigger
    // whose conditional update lands queues a run; one that loses the race to
    // a concurrent trigger sees the row is no longer FAILED and stops.
    if (!isNew) {
      const { count } = await this.prisma.migrationJob.updateMany({
        where: { id: job.id, status: JobStatus.FAILED },
        data: { status: JobStatus.QUEUED, errorMessage: null },
      });

      if (count === 0) {
        const current = await this.prisma.migrationJob.findUniqueOrThrow({
          where: { id: job.id },
        });
        this.logger.log(`Job ${job.id} was re-queued by another trigger, not re-queueing`);
        return { id: job.id, status: current.status, queued: false };
      }
    }

    const jobData: MigrationJobData = {
      jobId: job.id,
      repoUrl: input.repoUrl,
    };

    // No explicit BullMQ jobId: the database unique constraint already
    // deduplicates, and a retained id would block re-queueing a failed job.
    try {
      await this.migrationQueue.add(MIGRATION_JOB_NAME, jobData, RETRY_JOB_OPTIONS);
    } catch (error: unknown) {
      // A row left QUEUED with nothing in the queue would make every later
      // trigger skip it, so mark it FAILED to keep it retryable.
      await this.prisma.migrationJob.update({
        where: { id: job.id },
        data: { status: JobStatus.FAILED, errorMessage: `Could not queue job: ${String(error)}` },
      });
      throw error;
    }

    return { id: job.id, status: JobStatus.QUEUED, queued: true };
  }

  async findDetail(id: string): Promise<MigrationJobDetail | null> {
    const job = await this.prisma.migrationJob.findUnique({
      where: { id },
      include: { repository: true, executionLogs: { orderBy: { createdAt: 'asc' } } },
    });
    if (!job) {
      return null;
    }

    return {
      ...job,
      repository: {
        ...job.repository,
        githubRepoId: job.repository.githubRepoId.toString(),
        installationId: job.repository.installationId.toString(),
      },
    };
  }

  /**
   * Relies on the unique constraint rather than a read-then-write, so two
   * concurrent deliveries of the same release cannot both create a job.
   */
  private async findOrCreateJob(
    repositoryId: string,
    dependencyName: string,
    targetVersion: string,
  ) {
    try {
      const job = await this.prisma.migrationJob.create({
        data: {
          repositoryId,
          dependencyName,
          targetVersion,
          status: JobStatus.QUEUED,
        },
      });
      return { job, isNew: true };
    } catch (error: unknown) {
      const isDuplicate =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION;

      if (!isDuplicate) {
        throw error;
      }

      const job = await this.prisma.migrationJob.findUniqueOrThrow({
        where: {
          repositoryId_dependencyName_targetVersion: {
            repositoryId,
            dependencyName,
            targetVersion,
          },
        },
      });
      return { job, isNew: false };
    }
  }
}
