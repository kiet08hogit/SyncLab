import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { GithubTokenService } from '../github/github-token.service';
import { DockerSandboxService } from './sandbox/docker-sandbox.service';
import {
  BreakingChangeStatus,
  isMigratableKind,
  JobStatus,
  LogStep,
  MIGRATION_QUEUE,
  MigrationKind,
  type MigrationJobData,
} from '../common/constants';
import { configuration, LLM_API_KEY_ENV, type Configuration } from '../config/configuration';
import { ImpactConfidence } from '../impact/match';
import type { SandboxJobParams, StepLog } from './sandbox/sandbox.types';
import { buildValidationContext } from './sandbox/validation-context';
import { REMOVAL_KINDS, type RescanChange } from './sandbox/validation-context/rescan';
import { claimMigrationJob, type JobWithRepository } from './claim-job';

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Mirrors BullMQ's own decision: it retries until attempts run out, unless told not to. */
function willRetry(job: Job<MigrationJobData>, error: unknown): boolean {
  const unrecoverable =
    error instanceof UnrecoverableError || (error as Error | null)?.name === 'UnrecoverableError';
  return !unrecoverable && job.attemptsMade + 1 < (job.opts.attempts ?? 1);
}

// The decorator is evaluated at module load, before ConfigService exists.
const concurrency = configuration().worker.concurrency;

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

      const keyEnv = LLM_API_KEY_ENV[llm.provider];

      if (!llm.apiKey) {
        throw new UnrecoverableError(
          `LLM_PROVIDER is ${llm.provider} but ${keyEnv} is not set, so the refactoring phase cannot run.`,
        );
      }

      const migration = await this.migrationFor(record);
      const params: SandboxJobParams = {
        repoUrl: job.data.repoUrl || `https://github.com/${record.repository.fullName}.git`,
        repoFullName: record.repository.fullName,
        ...migration,
        validationContext: buildValidationContext(migration.migration, {
          removedChanges: await this.removedChanges(record.breakingChangeId),
        }),
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
      await this.fail(jobId, message, willRetry(job, error));
      throw error;
    }
  }

  /**
   * An API change is read again here rather than when it was queued: it may
   * have been dismissed since, and its impact's files follow the latest scan.
   */
  private async migrationFor(
    record: JobWithRepository,
  ): Promise<Pick<SandboxJobParams, 'migration' | 'branchName'>> {
    if (record.kind === MigrationKind.DEPENDENCY) {
      if (!record.dependencyName || !record.targetVersion) {
        throw new UnrecoverableError(`Dependency job ${record.id} has no dependency or version`);
      }
      return {
        migration: {
          kind: 'dependency',
          dependencyName: record.dependencyName,
          targetVersion: record.targetVersion,
        },
        branchName: `synclab/${slug(record.dependencyName)}-${slug(record.targetVersion)}`,
      };
    }

    const change = record.breakingChangeId
      ? await this.prisma.breakingChange.findUnique({
          where: { id: record.breakingChangeId },
          include: { provider: true, snapshot: { include: { source: true } } },
        })
      : null;
    if (!change || change.status !== BreakingChangeStatus.CONFIRMED) {
      throw new UnrecoverableError(
        'The breaking change is no longer confirmed, so there is nothing to migrate.',
      );
    }
    if (!isMigratableKind(change.kind)) {
      throw new UnrecoverableError(`A ${change.kind} change is reported, never migrated.`);
    }

    const impact = await this.prisma.apiImpact.findUnique({
      where: {
        breakingChangeId_repositoryId: {
          breakingChangeId: change.id,
          repositoryId: record.repositoryId,
        },
      },
    });
    if (impact?.confidence !== ImpactConfidence.CONFIRMED || impact.files.length === 0) {
      throw new UnrecoverableError(
        `The latest scan of ${record.repository.fullName} no longer confirms this change affects it.`,
      );
    }

    const subject = slug(change.field ?? change.operation ?? change.kind)
      .slice(0, 60)
      .replace(/-+$/, '');
    return {
      migration: {
        kind: 'api_change',
        change: {
          provider: change.provider.slug,
          kind: change.kind,
          operation: change.operation,
          field: change.field,
          replacement: change.replacement,
          effectiveAt: change.effectiveAt?.toISOString().slice(0, 10) ?? null,
          evidence: change.evidence,
          sourceUrl: change.snapshot.source.url,
        },
        files: impact.files,
      },
      branchName: `synclab/api-${change.provider.slug}-${subject}-${change.id.slice(0, 8)}`,
    };
  }

  /** Every confirmed retirement or removal except the change being migrated. */
  private async removedChanges(migratingChangeId: string | null): Promise<RescanChange[]> {
    const changes = await this.prisma.breakingChange.findMany({
      where: {
        status: BreakingChangeStatus.CONFIRMED,
        kind: { in: [...REMOVAL_KINDS] },
        ...(migratingChangeId ? { id: { not: migratingChangeId } } : {}),
      },
      orderBy: { id: 'asc' },
      select: { kind: true, operation: true, field: true, provider: { select: { slug: true } } },
    });
    return changes.map((change) => ({
      provider: change.provider.slug,
      kind: change.kind,
      operation: change.operation,
      field: change.field,
    }));
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
          step.exitCode === undefined ? step.output : `[exit ${step.exitCode}]\n${step.output}`,
      })),
    });
  }

  /**
   * Tolerates its own failure: the thrown error must reach BullMQ so the job
   * retries, even if writing the failure state did not work.
   *
   * A job BullMQ is about to retry stays QUEUED. Marking it FAILED during the
   * backoff would let a new trigger re-queue it, and the trigger's run and the
   * retry would then both execute.
   */
  private async fail(jobId: string, message: string, retrying: boolean): Promise<void> {
    try {
      await this.prisma.migrationJob.update({
        where: { id: jobId },
        data: { status: retrying ? JobStatus.QUEUED : JobStatus.FAILED, errorMessage: message },
      });
      await this.log(jobId, [{ step: LogStep.FAILED, output: message }]);
    } catch (error: unknown) {
      this.logger.error(`Could not record failure for job ${jobId}: ${String(error)}`);
    }
  }
}
