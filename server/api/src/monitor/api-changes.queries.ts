import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BreakingChangeStatus } from '../common/constants';

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
