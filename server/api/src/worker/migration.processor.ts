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

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Processor(MIGRATION_QUEUE)
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

    const record = await this.prisma.migrationJob.findUnique({
      where: { id: jobId },
      include: { repository: true },
    });

    if (!record) {
      throw new Error(`MigrationJob ${jobId} no longer exists`);
    }

    // A retry of a job that already produced a pull request must not open a second one.
    if (record.status === JobStatus.COMPLETED) {
      await this.log(jobId, [
        {
          step: LogStep.SKIPPED,
          output: `Job is already ${JobStatus.COMPLETED}${record.pullRequestUrl ? ` (${record.pullRequestUrl})` : ''}.`,
        },
      ]);
      return;
    }

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

    await this.prisma.migrationJob.update({
      where: { id: jobId },
      data: { status: JobStatus.IN_PROGRESS },
    });

    await this.log(jobId, [
      { step: LogStep.STARTED, output: `Starting migration for ${params.repoFullName}` },
    ]);

    try {
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
