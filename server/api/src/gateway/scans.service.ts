import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, type RepositoryScan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  JobStatus,
  SCAN_JOB_NAME,
  SCAN_QUEUE,
  type ScanJobData,
  type ScanTrigger,
} from '../common/constants';

// A failed scan is not retried here: the next push or a manual trigger is the
// retry, and it scans the newest commit rather than the one that failed.
const SCAN_JOB_OPTIONS = { attempts: 1, removeOnComplete: 100, removeOnFail: 500 };

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const MAX_CREATE_ATTEMPTS = 3;

export interface EnqueueScanInput {
  githubRepoId: bigint;
  fullName: string;
  installationId: bigint;
  repoUrl: string;
  trigger: ScanTrigger;
}

export interface EnqueueScanResult {
  id: string;
  status: string;
  queued: boolean;
}

export interface ApiUsageOut {
  provider: string;
  file: string;
  line: number;
  style: string;
  method: string | null;
  operation: string | null;
  params: string[];
  modelIds: string[];
  dynamic: boolean;
}

export interface ScanOut {
  id: string;
  trigger: string;
  status: string;
  commitSha: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RepositoryApiUsage {
  fullName: string;
  /** The newest scan, which may still be running or may have failed. */
  latestScan: ScanOut | null;
  /** The newest scan that completed, which the usages come from. */
  usageScan: ScanOut | null;
  usages: ApiUsageOut[];
}

function scanOut(scan: {
  id: string;
  trigger: string;
  status: string;
  commitSha: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ScanOut {
  return {
    id: scan.id,
    trigger: scan.trigger,
    status: scan.status,
    commitSha: scan.commitSha,
    errorMessage: scan.errorMessage,
    createdAt: scan.createdAt,
    updatedAt: scan.updatedAt,
  };
}

/**
 * Shared by the installation and push webhooks and the manual trigger, so all
 * three record a repository and queue its scan the same way.
 */
@Injectable()
export class ScansService {
  private readonly logger = new Logger(ScansService.name);

  constructor(
    @InjectQueue(SCAN_QUEUE) private readonly scanQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async enqueue(input: EnqueueScanInput): Promise<EnqueueScanResult> {
    const repo = await this.prisma.repository.upsert({
      where: { githubRepoId: input.githubRepoId },
      create: {
        githubRepoId: input.githubRepoId,
        fullName: input.fullName,
        installationId: input.installationId,
      },
      update: { fullName: input.fullName, installationId: input.installationId },
    });

    // A scan that has not started yet will clone the newest commit anyway, so
    // a burst of pushes shares it. The unique queuedFor column makes that hold
    // under concurrent triggers too, without a read-then-write race.
    let scan: RepositoryScan | undefined;
    for (let attempt = 1; !scan; attempt++) {
      try {
        scan = await this.prisma.repositoryScan.create({
          data: {
            repositoryId: repo.id,
            trigger: input.trigger,
            status: JobStatus.QUEUED,
            queuedFor: repo.id,
          },
        });
      } catch (error: unknown) {
        const isDuplicate =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === UNIQUE_CONSTRAINT_VIOLATION;
        if (!isDuplicate) {
          throw error;
        }

        const waiting = await this.prisma.repositoryScan.findUnique({
          where: { queuedFor: repo.id },
        });
        if (waiting) {
          this.logger.log(
            `Scan ${waiting.id} of ${input.fullName} is already waiting, not queueing`,
          );
          return { id: waiting.id, status: waiting.status, queued: false };
        }
        // The waiting scan started between the two queries, so try again.
        if (attempt === MAX_CREATE_ATTEMPTS) {
          throw error;
        }
      }
    }

    const jobData: ScanJobData = { scanId: scan.id, repoUrl: input.repoUrl };

    try {
      await this.scanQueue.add(SCAN_JOB_NAME, jobData, SCAN_JOB_OPTIONS);
    } catch (error: unknown) {
      // A row left waiting with nothing in the queue would absorb every later
      // trigger, so release the slot.
      await this.prisma.repositoryScan.update({
        where: { id: scan.id },
        data: {
          status: JobStatus.FAILED,
          queuedFor: null,
          errorMessage: `Could not queue scan: ${String(error)}`,
        },
      });
      throw error;
    }

    return { id: scan.id, status: JobStatus.QUEUED, queued: true };
  }

  /** Undefined when SyncLab has not recorded the repository. */
  async usageFor(githubRepoId: bigint): Promise<RepositoryApiUsage | undefined> {
    const repository = await this.prisma.repository.findUnique({ where: { githubRepoId } });
    if (!repository) {
      return undefined;
    }

    const [latestScan, usageScan] = await Promise.all([
      this.prisma.repositoryScan.findFirst({
        where: { repositoryId: repository.id },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.repositoryScan.findFirst({
        where: { repositoryId: repository.id, status: JobStatus.COMPLETED },
        orderBy: { createdAt: 'desc' },
        include: {
          usages: { include: { provider: true }, orderBy: [{ file: 'asc' }, { line: 'asc' }] },
        },
      }),
    ]);

    return {
      fullName: repository.fullName,
      latestScan: latestScan ? scanOut(latestScan) : null,
      usageScan: usageScan ? scanOut(usageScan) : null,
      usages: (usageScan?.usages ?? []).map((usage) => ({
        provider: usage.provider.slug,
        file: usage.file,
        line: usage.line,
        style: usage.style,
        method: usage.method,
        operation: usage.operation,
        params: usage.params,
        modelIds: usage.modelIds,
        dynamic: usage.dynamic,
      })),
    };
  }
}
