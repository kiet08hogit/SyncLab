import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { GithubTokenService } from '../github/github-token.service';
import { DockerSandboxService } from './sandbox/docker-sandbox.service';
import { JobStatus, SCAN_QUEUE, type ScanJobData } from '../common/constants';
import { configuration } from '../config/configuration';

// The decorator is evaluated at module load, before ConfigService exists.
const concurrency = configuration().worker.concurrency;

/**
 * Runs a repository scan and stores what it found in the API usage registry.
 * A scan is cheap and repeatable, so it is not retried: the next push or a
 * manual trigger scans again.
 */
@Processor(SCAN_QUEUE, { concurrency })
export class ScanProcessor extends WorkerHost {
  private readonly logger = new Logger(ScanProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sandbox: DockerSandboxService,
    private readonly githubToken: GithubTokenService,
  ) {
    super();
  }

  async process(job: Job<ScanJobData>): Promise<void> {
    const { scanId, repoUrl } = job.data;

    // Starting the scan also frees the repository's waiting slot, so a push
    // that lands from here on queues a scan of its own.
    const { count } = await this.prisma.repositoryScan.updateMany({
      where: { id: scanId, status: { in: [JobStatus.QUEUED, JobStatus.IN_PROGRESS] } },
      data: { status: JobStatus.IN_PROGRESS, queuedFor: null },
    });
    if (count === 0) {
      this.logger.log(`Scan ${scanId} already finished, not running it again`);
      return;
    }

    try {
      const scan = await this.prisma.repositoryScan.findUniqueOrThrow({
        where: { id: scanId },
        include: { repository: true },
      });
      const token = await this.githubToken.getInstallationToken(scan.repository.installationId);

      await this.sandbox.ensureImage();
      const outcome = await this.sandbox.scan(scanId, { repoUrl, token });

      if (!outcome.ok) {
        await this.fail(scanId, outcome.error ?? 'scan failed', outcome.output, outcome.commitSha);
        return;
      }

      const providers = await this.prisma.apiProvider.findMany();
      const providerIds = new Map(providers.map((provider) => [provider.slug, provider.id]));

      await this.prisma.$transaction([
        this.prisma.apiUsage.deleteMany({
          where: {
            scan: {
              repositoryId: scan.repositoryId,
              status: JobStatus.COMPLETED,
              id: { not: scanId },
              createdAt: { lt: scan.createdAt },
            },
          },
        }),
        this.prisma.apiUsage.createMany({
          data: outcome.usages.flatMap((usage) => {
            const providerId = providerIds.get(usage.provider);
            return providerId
              ? [
                  {
                    scanId,
                    providerId,
                    file: usage.file,
                    line: usage.line,
                    style: usage.style,
                    method: usage.method ?? null,
                    operation: usage.operation,
                    params: usage.params,
                    modelIds: usage.modelIds,
                    dynamic: usage.dynamic,
                  },
                ]
              : [];
          }),
        }),
        this.prisma.repositoryScan.update({
          where: { id: scanId },
          data: {
            status: JobStatus.COMPLETED,
            commitSha: outcome.commitSha ?? null,
            output: outcome.output,
            errorMessage: null,
          },
        }),
      ]);
    } catch (error: unknown) {
      await this.fail(scanId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /** Tolerates its own failure, so the original error still reaches BullMQ. */
  private async fail(
    scanId: string,
    message: string,
    output?: string,
    commitSha?: string,
  ): Promise<void> {
    try {
      await this.prisma.repositoryScan.update({
        where: { id: scanId },
        data: {
          status: JobStatus.FAILED,
          errorMessage: message,
          output: output ?? null,
          commitSha: commitSha ?? null,
        },
      });
    } catch (error: unknown) {
      this.logger.error(`Could not record failure for scan ${scanId}: ${String(error)}`);
    }
  }
}
