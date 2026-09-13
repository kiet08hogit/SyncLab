import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { GithubTokenService } from '../github/github-token.service';
import { DockerSandboxService } from './sandbox/docker-sandbox.service';
import { JobStatus, LogStep, MIGRATION_QUEUE, type MigrationJobData } from '../common/constants';
import type { Configuration } from '../config/configuration';
import type { SandboxJobParams, StepLog } from './sandbox/sandbox.types';
import { claimMigrationJob } from './claim-job';

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const concurrency = Math.max(1, Math.floor(Number(process.env.WORKER_CONCURRENCY) || 1));

@Processor(MIGRATION_QUEUE, { concurrency })
export class MigrationProcessor extends WorkerHost {
  private readonly logger = new Logger(MigrationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sandbox: DockerSandboxService,
    private readonly githubToken: GithubTokenService,
    private readonly config: ConfigService<Configuration, true>,
  ) {
    super();
  }

  async process(job: Job<MigrationJobData>): Promise<void> {
    const { jobId } = job.data;

    const claimed = await claimMigrationJob(this.prisma, jobId);
    if (claimed.kind === 'skipped') {
      await this.log(jobId, [
        {
          step: LogStep.SKIPPED,
          output: `Job is already ${JobStatus.COMPLETED}${claimed.pullRequestUrl ? ` (${claimed.pullRequestUrl})` : ''}.`,
        },
      ]);
      return;
    }

    const record = claimed.record;

    try {
      const token = await this.githubToken.getInstallationToken(record.repository.installationId);
      const llm = this.config.get('llm', { infer: true });

      if (!llm.apiKey) {
        throw new UnrecoverableError(
          'GEMINI_API_KEY is not set, so the refactoring phase cannot run.',
        );
      }

      const params: SandboxJobParams = {
        repoUrl: job.data.repoUrl || `https://github.com/${record.repository.fullName}.git`,
        repoFullName: record.repository.fullName,
        dependencyName: record.dependencyName,
        targetVersion: record.targetVersion,
        branchName: `synclab/${slug(record.dependencyName)}-${slug(record.targetVersion)}`,
        token,
        llm,
      };

      await this.log(jobId, [
        { step: LogStep.STARTED, output: `Starting migration for ${params.repoFullName}` },
      ]);

      await this.sandbox.ensureImage();

      const outcome = await this.sandbox.run(jobId, params, (steps) => this.log(jobId, steps));

      if (!outcome.ok) {
        const message = outcome.error ?? 'sandbox run failed';

        // The catch below records the failure either way. Only a transient
        // failure earns a retry: replaying a migration the model got wrong, or
        // that its own test suite rejected, just spends the quota again.
        throw outcome.retryable ? new Error(message) : new UnrecoverableError(message);
      }

      await this.prisma.migrationJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          pullRequestUrl: outcome.pullRequestUrl ?? null,
          errorMessage: null,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.fail(jobId, message);
      throw error;
    }
  }

  private async log(jobId: string, steps: StepLog[]): Promise<void> {
    if (steps.length === 0) {
      return;
    }

    await this.prisma.executionLog.createMany({
      data: steps.map((step) => ({
        jobId,
        step: step.step,
        output:
          step.exitCode === undefined
            ? step.output
            : `[exit ${step.exitCode}]\n${step.output}`,
      })),
    });
  }

  /**
   * Tolerates its own failure: the thrown error must reach BullMQ so the job
   * retries, even if writing the failure state did not work.
   */
  private async fail(jobId: string, message: string): Promise<void> {
    try {
      await this.prisma.migrationJob.update({
        where: { id: jobId },
        data: { status: JobStatus.FAILED, errorMessage: message },
      });
      await this.log(jobId, [{ step: LogStep.FAILED, output: message }]);
    } catch (error: unknown) {
      this.logger.error(`Could not record failure for job ${jobId}: ${String(error)}`);
    }
  }
}
