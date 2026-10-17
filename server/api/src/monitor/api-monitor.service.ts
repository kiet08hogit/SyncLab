import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BreakingChangeStatus } from '../common/constants';
import {
  extractTables,
  normalizeTables,
  parseDeprecations,
  subjectKey,
  type ParsedChange,
} from './deprecations';

const FETCH_TIMEOUT_MS = 30_000;
// The deprecation pages are around 500 KB; anything far larger is not the page.
const MAX_PAGE_BYTES = 10 * 1024 * 1024;
const USER_AGENT = 'SyncLab API monitor (+https://github.com/kiet08hogit/SyncLab)';

export type PageFetcher = (url: string) => Promise<string>;

export async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GET ${url} returned ${response.status}`);
  }
  const body = await response.text();
  if (body.length > MAX_PAGE_BYTES) {
    throw new Error(
      `GET ${url} returned ${body.length} characters, more than the ${MAX_PAGE_BYTES} allowed`,
    );
  }
  return body;
}

export interface SourceRef {
  id: string;
  providerId: string;
  kind: string;
  url: string;
}

export interface PollResult {
  sourceId: string;
  url: string;
  /** False when the content matched the latest snapshot, so nothing was stored. */
  changed: boolean;
  created: number;
  updated: number;
  error?: string;
}

/**
 * Polls the providers' sources and turns what changed into breaking-change
 * records. Model deprecation tables are the providers' own statements of what
 * is retired and when, so changes read from them are confirmed directly.
 */
@Injectable()
export class ApiMonitorService {
  private readonly logger = new Logger(ApiMonitorService.name);
  private fetcher: PageFetcher = fetchPage;

  constructor(private readonly prisma: PrismaService) {}

  /** For tests: replaces the network with recorded pages. */
  useFetcher(fetcher: PageFetcher): void {
    this.fetcher = fetcher;
  }

  async pollAll(): Promise<PollResult[]> {
    const sources = await this.prisma.apiSource.findMany({ orderBy: { createdAt: 'asc' } });
    const results: PollResult[] = [];
    // One at a time: there are a handful of sources and no reason to hit a
    // provider in parallel. Each source is stamped with its own fetch time.
    for (const source of sources) {
      results.push(await this.pollSource(source));
    }
    return results;
  }

  async pollSource(source: SourceRef, now = new Date()): Promise<PollResult> {
    try {
      const html = await this.fetcher(source.url);
      return await this.recordSnapshot(source, normalizeTables(extractTables(html)), now);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Polling ${source.url} failed: ${message}`);
      await this.prisma.apiSource.update({
        where: { id: source.id },
        data: { lastCheckedAt: now, lastError: message },
      });
      return {
        sourceId: source.id,
        url: source.url,
        changed: false,
        created: 0,
        updated: 0,
        error: message,
      };
    }
  }

  /**
   * Stores the content as a new snapshot only when it differs from the latest
   * one, and applies the changes it states. Feeding the same content twice
   * changes nothing, which is what makes a recorded snapshot replayable.
   */
  async recordSnapshot(source: SourceRef, content: string, now = new Date()): Promise<PollResult> {
    const base = { sourceId: source.id, url: source.url };
    const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');
    const latest = await this.prisma.apiSourceSnapshot.findFirst({
      where: { sourceId: source.id },
      orderBy: { fetchedAt: 'desc' },
      select: { contentHash: true },
    });

    if (latest?.contentHash === contentHash) {
      await this.prisma.apiSource.update({
        where: { id: source.id },
        data: { lastCheckedAt: now, lastError: null },
      });
      return { ...base, changed: false, created: 0, updated: 0 };
    }

    const { changes } = parseDeprecations(content);
    // A redesigned page would otherwise read as "nothing is retired" and go unnoticed.
    if (changes.length === 0) {
      throw new Error('No retirement tables were found; the page layout may have changed');
    }

    const counts = await this.prisma.$transaction(async (tx) => {
      // Polls of one source may run on different workers; only one records a snapshot.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${source.id}))`;
      const current = await tx.apiSourceSnapshot.findFirst({
        where: { sourceId: source.id },
        orderBy: { fetchedAt: 'desc' },
        select: { contentHash: true },
      });
      await tx.apiSource.update({
        where: { id: source.id },
        data: { lastCheckedAt: now, lastError: null },
      });
      if (current?.contentHash === contentHash) return null;

      const snapshot = await tx.apiSourceSnapshot.create({
        data: { sourceId: source.id, contentHash, content, fetchedAt: now },
      });
      return this.applyChanges(tx, source.providerId, snapshot.id, changes);
    });
    if (!counts) return { ...base, changed: false, created: 0, updated: 0 };

    this.logger.log(
      `${source.url}: new snapshot, ${counts.created} new and ${counts.updated} updated changes`,
    );
    return { ...base, changed: true, ...counts };
  }

  /**
   * Creates the changes not seen before and updates the ones whose details
   * moved (a retirement date pushed back, a replacement named). A change that
   * was dismissed keeps its status, and one that disappears from the page is
   * kept: a provider tidying its page does not un-retire a model.
   */
  private async applyChanges(
    tx: Pick<PrismaService, 'breakingChange'>,
    providerId: string,
    snapshotId: string,
    changes: ParsedChange[],
  ): Promise<{ created: number; updated: number }> {
    const existing = await tx.breakingChange.findMany({
      where: { providerId, subjectKey: { in: changes.map(subjectKey) } },
    });
    const byKey = new Map(existing.map((row) => [`${row.kind}:${row.subjectKey}`, row]));
    let created = 0;
    let updated = 0;

    for (const change of changes) {
      const key = subjectKey(change);
      const details = {
        replacement: change.replacement,
        effectiveAt: change.effectiveAt ? new Date(`${change.effectiveAt}T00:00:00Z`) : null,
        section: change.section,
        evidence: change.evidence,
      };
      const row = byKey.get(`${change.kind}:${key}`);

      if (!row) {
        await tx.breakingChange.create({
          data: {
            providerId,
            snapshotId,
            kind: change.kind,
            operation: change.operation,
            field: change.field,
            subjectKey: key,
            status: BreakingChangeStatus.CONFIRMED,
            ...details,
          },
        });
        created++;
        continue;
      }

      const moved =
        row.replacement !== details.replacement ||
        (row.effectiveAt?.getTime() ?? null) !== (details.effectiveAt?.getTime() ?? null) ||
        row.section !== details.section ||
        row.evidence !== details.evidence;
      if (moved) {
        await tx.breakingChange.update({ where: { id: row.id }, data: { snapshotId, ...details } });
        updated++;
      }
    }

    return { created, updated };
  }
}
