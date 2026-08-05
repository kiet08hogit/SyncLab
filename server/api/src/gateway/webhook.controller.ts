import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GithubSignatureGuard } from './github-signature.guard';
import type { GithubReleasePayload } from './webhook.types';
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

@Controller('webhook')
@UseGuards(GithubSignatureGuard)
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    @InjectQueue(MIGRATION_QUEUE) private readonly migrationQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async handleWebhook(
    @Body() payload: GithubReleasePayload,
    @Headers('x-github-event') event?: string,
  ) {
    if (event === 'ping') {
      return { ok: true };
    }

    if (event !== 'release' || payload.action !== 'published') {
      return { ignored: true, reason: `event "${event ?? 'unknown'}" is not a published release` };
    }

    const repository = payload.repository;
    if (!repository?.id || !repository.full_name) {
      throw new BadRequestException('Payload is missing repository.id or repository.full_name');
    }

    const targetVersion = payload.release?.tag_name;
    if (!targetVersion) {
      throw new BadRequestException('Payload is missing release.tag_name');
    }

    const installationId = payload.installation?.id;
    if (!installationId) {
      throw new BadRequestException(
        'Payload is missing installation.id, so no GitHub App installation token can be issued',
      );
    }

    const dependencyName = payload.release?.name || repository.name || repository.full_name;

    const repo = await this.prisma.repository.upsert({
      where: { githubRepoId: BigInt(repository.id) },
      create: {
        githubRepoId: BigInt(repository.id),
        fullName: repository.full_name,
        installationId: BigInt(installationId),
      },
      update: {
        fullName: repository.full_name,
        installationId: BigInt(installationId),
      },
    });

    const { job, isNew } = await this.findOrCreateJob(repo.id, dependencyName, targetVersion);

    // A redelivered webhook must not open a second pull request, but a job that
    // previously failed is worth another attempt.
    if (!isNew && job.status !== JobStatus.FAILED) {
      this.logger.log(`Job ${job.id} is already ${job.status}, not re-queueing`);
      return { id: job.id, status: job.status, queued: false };
    }

    const jobData: MigrationJobData = {
      jobId: job.id,
      repoUrl: repository.clone_url ?? `https://github.com/${repository.full_name}.git`,
    };

    // No explicit BullMQ jobId: the database unique constraint already
    // deduplicates, and a retained id would block re-queueing a failed job.
    await this.migrationQueue.add(MIGRATION_JOB_NAME, jobData, RETRY_JOB_OPTIONS);

    return { id: job.id, status: JobStatus.QUEUED, queued: true };
  }

  /**
   * Relies on the unique constraint rather than a read-then-write, so two
   * concurrent deliveries of the same release cannot both create a job.
   */
  private async findOrCreateJob(repositoryId: string, dependencyName: string, targetVersion: string) {
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
