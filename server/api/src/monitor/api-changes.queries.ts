import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BreakingChangeStatus } from '../common/constants';
import type { Caller } from '../gateway/api-auth.guard';

export interface ChangeFilters {
  provider?: string;
  status?: string;
  kind?: string;
}

// Far above what the providers' pages hold (around 200 changes today).
const MAX_CHANGES = 1000;

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** The monitor's read side, in the shapes documented in 05 - Self-Maintaining API. */
@Injectable()
export class ApiChangesQueries {
  constructor(private readonly prisma: PrismaService) {}

  /** Live totals. `changesDetected` counts every recorded change; the other figures are limited to repositories the caller may see. */
  async metrics(caller: Caller) {
    const ids = caller.kind === 'user' ? [...caller.repositories.keys()] : null;
    const changesDetected = await this.prisma.breakingChange.count();
    if (ids && ids.length === 0) {
      return {
        changesDetected,
        repositoriesImpacted: 0,
        migrationPrCount: 0,
        averageDetectionToPrSeconds: null,
      };
    }
    const repoScope = ids
      ? Prisma.sql`AND r.github_repo_id IN (${Prisma.join(ids)})`
      : Prisma.empty;
    const [impacted, latency] = await Promise.all([
      this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT COUNT(DISTINCT i.repository_id)::int AS count
        FROM api_impacts i JOIN repositories r ON r.id = i.repository_id
        WHERE true ${repoScope}
      `),
      this.prisma.$queryRaw<Array<{ count: number; average: number | null }>>(Prisma.sql`
        SELECT COUNT(*)::int AS count, AVG(seconds)::float AS average
        FROM (
          SELECT GREATEST(0, EXTRACT(EPOCH FROM (MIN(l.created_at) - c.detected_at))) AS seconds
          FROM migration_jobs j
          JOIN repositories r ON r.id = j.repository_id
          JOIN breaking_changes c ON c.id = j.breaking_change_id
          JOIN execution_logs l ON l.job_id = j.id
          WHERE j.kind = 'api_change' AND j.pull_request_url IS NOT NULL
            AND l.step = 'PR' AND l.output LIKE '%opened %' ${repoScope}
          GROUP BY j.id, c.detected_at
        ) completed
      `),
    ]);
    return {
      changesDetected,
      repositoriesImpacted: impacted[0]?.count ?? 0,
      migrationPrCount: latency[0]?.count ?? 0,
      averageDetectionToPrSeconds: latency[0]?.average ?? null,
    };
  }

  async listProviders() {
    const [providers, counts] = await Promise.all([
      this.prisma.apiProvider.findMany({
        orderBy: { slug: 'asc' },
        include: {
          sources: {
            orderBy: { createdAt: 'asc' },
            include: { snapshots: { orderBy: { fetchedAt: 'desc' }, take: 1 } },
          },
        },
      }),
      this.prisma.breakingChange.groupBy({ by: ['providerId', 'status'], _count: { _all: true } }),
    ]);

    return providers.map((provider) => {
      const changeCounts: Record<string, number> = Object.fromEntries(
        Object.values(BreakingChangeStatus).map((status) => [status, 0]),
      );
      for (const count of counts) {
        if (count.providerId === provider.id) changeCounts[count.status] = count._count._all;
      }
      return {
        slug: provider.slug,
        sources: provider.sources.map((source) => {
          const latest = source.snapshots[0];
          return {
            kind: source.kind,
            url: source.url,
            lastCheckedAt: source.lastCheckedAt?.toISOString() ?? null,
            lastError: source.lastError,
            latestSnapshot: latest
              ? {
                  id: latest.id,
                  contentHash: latest.contentHash,
                  fetchedAt: latest.fetchedAt.toISOString(),
                }
              : null,
          };
        }),
        changeCounts,
      };
    });
  }

  async listChanges(filters: ChangeFilters) {
    const changes = await this.prisma.breakingChange.findMany({
      where: {
        ...(filters.provider ? { provider: { slug: filters.provider } } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.kind ? { kind: filters.kind } : {}),
      },
      orderBy: [{ detectedAt: 'desc' }, { id: 'asc' }],
      take: MAX_CHANGES,
      include: CHANGE_INCLUDE,
    });

    return changes.map(toChangeView);
  }

  /**
   * Confirming or dismissing is idempotent, and a dismissed change can be
   * confirmed again. Returns null for an unknown change.
   */
  async setStatus(id: string, status: BreakingChangeStatus) {
    const { count } = await this.prisma.breakingChange.updateMany({
      where: { id },
      data: { status },
    });
    if (count === 0) {
      return null;
    }
    const change = await this.prisma.breakingChange.findUniqueOrThrow({
      where: { id },
      include: CHANGE_INCLUDE,
    });
    return toChangeView(change);
  }
}

const CHANGE_INCLUDE = { provider: true, snapshot: { include: { source: true } } } as const;

type ChangeRow = Prisma.BreakingChangeGetPayload<{ include: typeof CHANGE_INCLUDE }>;

function toChangeView(change: ChangeRow) {
  return {
    id: change.id,
    provider: change.provider.slug,
    kind: change.kind,
    operation: change.operation,
    field: change.field,
    replacement: change.replacement,
    effectiveAt: isoDate(change.effectiveAt),
    section: change.section,
    evidence: change.evidence,
    status: change.status,
    source: { kind: change.snapshot.source.kind, url: change.snapshot.source.url },
    snapshotId: change.snapshotId,
    detectedAt: change.detectedAt.toISOString(),
    updatedAt: change.updatedAt.toISOString(),
  };
}
