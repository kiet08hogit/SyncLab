import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BreakingChangeStatus, JobStatus } from '../common/constants';
import type { Caller } from '../gateway/api-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { collectImpacts } from './match';

// Held for the whole write, so a scan and a confirmation cannot rebuild the
// same rows at once. pg_advisory_xact_lock(int, int) releases it on commit.
const IMPACT_LOCK_A = 17;
const IMPACT_LOCK_B = 2014;

type Db = Prisma.TransactionClient;

const CHANGE_SELECT = {
  id: true,
  providerId: true,
  kind: true,
  operation: true,
  field: true,
} as const;

const SCAN_SELECT = {
  repositoryId: true,
  usages: {
    select: {
      providerId: true,
      file: true,
      operation: true,
      params: true,
      modelIds: true,
      dynamic: true,
    },
  },
} as const;

/**
 * Joins confirmed breaking changes to the newest completed scan of each
 * repository. Detected changes have no rows; dismissing a change deletes them.
 */
@Injectable()
export class ImpactService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pass the scan transaction so the new usages and their impacts commit
   * together. The caller has already marked that scan completed.
   */
  recomputeRepository(repositoryId: string, tx?: Db): Promise<void> {
    return this.recompute({ repositoryId }, tx);
  }

  recomputeChange(changeId: string): Promise<void> {
    return this.recompute({ changeId });
  }

  recomputeAll(): Promise<void> {
    return this.recompute({});
  }

  /** Null when the change does not exist. A user only sees repositories they can reach. */
  async list(changeId: string, caller: Caller) {
    const change = await this.prisma.breakingChange.findUnique({
      where: { id: changeId },
      select: { id: true },
    });
    if (!change) return null;

    const githubRepoIds = caller.kind === 'user' ? [...caller.repositories.keys()] : null;
    if (githubRepoIds && githubRepoIds.length === 0) {
      return { changeId, impacts: [] };
    }

    const rows = await this.prisma.apiImpact.findMany({
      where: {
        breakingChangeId: changeId,
        ...(githubRepoIds ? { repository: { githubRepoId: { in: githubRepoIds } } } : {}),
      },
      include: { repository: true },
    });

    return {
      changeId,
      impacts: rows
        .map((row) => ({
          repositoryId: row.repositoryId,
          githubRepoId: row.repository.githubRepoId.toString(),
          fullName: row.repository.fullName,
          confidence: row.confidence,
          files: row.files,
        }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    };
  }

  private async recompute(
    scope: { repositoryId?: string; changeId?: string },
    tx?: Db,
  ): Promise<void> {
    if (tx) {
      await this.replace(tx, scope);
      return;
    }
    await this.prisma.$transaction((db) => this.replace(db, scope));
  }

  private async replace(
    db: Db,
    scope: { repositoryId?: string; changeId?: string },
  ): Promise<void> {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(${IMPACT_LOCK_A}, ${IMPACT_LOCK_B})`;

    const changes = await db.breakingChange.findMany({
      where: {
        status: BreakingChangeStatus.CONFIRMED,
        ...(scope.changeId ? { id: scope.changeId } : {}),
      },
      select: CHANGE_SELECT,
    });

    if (scope.changeId && changes.length === 0) {
      await db.apiImpact.deleteMany({ where: { breakingChangeId: scope.changeId } });
      return;
    }

    const scans = await db.repositoryScan.findMany({
      where: {
        status: JobStatus.COMPLETED,
        ...(scope.repositoryId ? { repositoryId: scope.repositoryId } : {}),
      },
      orderBy: [{ repositoryId: 'asc' }, { createdAt: 'desc' }],
      distinct: ['repositoryId'],
      select: SCAN_SELECT,
    });

    const drafts = collectImpacts(changes, scans);
    if (scope.repositoryId) {
      await db.apiImpact.deleteMany({ where: { repositoryId: scope.repositoryId } });
    } else if (scope.changeId) {
      await db.apiImpact.deleteMany({ where: { breakingChangeId: scope.changeId } });
    } else {
      await db.apiImpact.deleteMany();
    }
    if (drafts.length > 0) {
      await db.apiImpact.createMany({ data: drafts });
    }
  }
}
