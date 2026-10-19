import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BreakingChangeStatus } from '../common/constants';
import { ImpactService } from '../impact/impact.service';
import { DockerSandboxService } from '../worker/sandbox/docker-sandbox.service';
import type { SandboxClassifyInput } from '../worker/sandbox/sandbox.types';
import { extractTables, normalizeTables, parseDeprecations, subjectKey } from './deprecations';
import { diffSurfaces, extractSurface } from './openapi-spec';
import { addedSections, extractText, verifyClassified } from './release-notes';

const FETCH_TIMEOUT_MS = 30_000;
// The largest source, OpenAI's OpenAPI spec, is around 5 MB.
const MAX_PAGE_BYTES = 20 * 1024 * 1024;
const USER_AGENT = 'SyncLab API monitor (+https://github.com/kiet08hogit/SyncLab)';

// A page counts as re-baselined, not updated, when this share of it is new.
const REBASELINE_SHARE = 0.5;
const REBASELINE_MIN_LINES = 40;

export type PageFetcher = (url: string, accept: string) => Promise<string>;

export async function fetchPage(url: string, accept: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept },
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
  provider?: { slug: string };
  lastError?: string | null;
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

/** A change read from any source, before it is stored. */
interface MonitorChange {
  kind: string;
  operation: string | null;
  field: string | null;
  replacement: string | null;
  effectiveAt: string | null;
  section: string | null;
  evidence: string;
}

interface ReadChanges {
  changes: MonitorChange[];
  /**
   * Confirmed for the providers' own tables and spec. Detected for what a
   * model read from prose: a person confirms those before they start work.
   */
  status: BreakingChangeStatus;
}

/**
 * Polls the providers' sources and turns what changed into breaking-change
 * records: deprecation tables and the OpenAPI spec deterministically, release
 * notes and SDK changelogs through the classify sandbox phase.
 */
@Injectable()
export class ApiMonitorService {
  private readonly logger = new Logger(ApiMonitorService.name);
  private fetcher: PageFetcher = fetchPage;

  constructor(
    private readonly prisma: PrismaService,
    private readonly impact: ImpactService,
    @Optional() private readonly sandbox?: DockerSandboxService,
  ) {}

  /** For tests: replaces the network with recorded pages. */
  useFetcher(fetcher: PageFetcher): void {
    this.fetcher = fetcher;
  }

  async pollAll(): Promise<PollResult[]> {
    const sources = await this.prisma.apiSource.findMany({
      orderBy: { createdAt: 'asc' },
      include: { provider: { select: { slug: true } } },
    });
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
      const body = await this.fetcher(source.url, acceptFor(source.kind));
      return await this.recordSnapshot(source, contentOf(source.kind, body), now);
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
   * The changes are worked out before the transaction, because classifying
   * release notes calls a model and must not hold the lock.
   */
  async recordSnapshot(source: SourceRef, content: string, now = new Date()): Promise<PollResult> {
    const base = { sourceId: source.id, url: source.url };
    const unchanged = { ...base, changed: false, created: 0, updated: 0 };
    const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');
    const latest = await this.prisma.apiSourceSnapshot.findFirst({
      where: { sourceId: source.id },
      orderBy: { fetchedAt: 'desc' },
      select: { contentHash: true, content: true },
    });
    const retryImpact = source.lastError != null;

    if (latest?.contentHash === contentHash) {
      if (retryImpact) await this.impact.recomputeAll();
      await this.prisma.apiSource.update({
        where: { id: source.id },
        data: retryImpact
          ? { lastCheckedAt: now, lastError: null }
          : { lastCheckedAt: now },
      });
      return unchanged;
    }

    // A failure here (a model that cannot be reached, a redesigned page)
    // throws before anything is stored, so the next poll tries the same
    // content again instead of losing it.
    const read = await this.readChanges(source, latest?.content ?? null, content);

    const counts = await this.prisma.$transaction(async (tx) => {
      // Polls of one source may run on different workers; only one records a snapshot.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${source.id}))`;
      const current = await tx.apiSourceSnapshot.findFirst({
        where: { sourceId: source.id },
        orderBy: { fetchedAt: 'desc' },
        select: { contentHash: true },
      });
      // Another poll stored a snapshot since this one read the latest. Its
      // changes were worked out against an older snapshot, so the next poll
      // diffs again from the new one.
      if ((current?.contentHash ?? null) !== (latest?.contentHash ?? null)) {
        await tx.apiSource.update({
          where: { id: source.id },
          data: { lastCheckedAt: now },
        });
        return null;
      }

      await tx.apiSource.update({
        where: { id: source.id },
        data: { lastCheckedAt: now, lastError: null },
      });
      const snapshot = await tx.apiSourceSnapshot.create({
        data: { sourceId: source.id, contentHash, content, fetchedAt: now },
      });
      return this.applyChanges(tx, source.providerId, snapshot.id, read);
    });
    if (!counts) {
      if (retryImpact) await this.impact.recomputeAll();
      return unchanged;
    }

    if (retryImpact || (read.status === BreakingChangeStatus.CONFIRMED && counts.created > 0)) {
      await this.impact.recomputeAll();
    }

    this.logger.log(
      `${source.url}: new snapshot, ${counts.created} new and ${counts.updated} updated changes`,
    );
    return { ...base, changed: true, ...counts };
  }

  /**
   * The spec diff and the classifier compare against the previous snapshot,
   * so a source's first snapshot is a baseline: years of past notes are not
   * reported as new.
   */
  private async readChanges(
    source: SourceRef,
    previous: string | null,
    content: string,
  ): Promise<ReadChanges> {
    switch (source.kind) {
      case 'deprecations': {
        const { changes } = parseDeprecations(content);
        // A redesigned page would otherwise read as "nothing is retired" and go unnoticed.
        if (changes.length === 0) {
          throw new Error('No retirement tables were found; the page layout may have changed');
        }
        return { changes, status: BreakingChangeStatus.CONFIRMED };
      }
      case 'spec':
        return {
          changes: previous === null ? [] : diffSurfaces(previous, content),
          status: BreakingChangeStatus.CONFIRMED,
        };
      case 'release_notes':
      case 'sdk_changelog':
        return {
          changes: previous === null ? [] : await this.classify(source, previous, content),
          status: BreakingChangeStatus.DETECTED,
        };
      default:
        throw new Error(`Unknown source kind ${source.kind}`);
    }
  }

  /**
   * Only the lines added since the previous snapshot are sent to the model,
   * and only changes whose evidence is a verbatim quote of the snapshot are
   * kept, so a model cannot invent a breaking change.
   */
  private async classify(
    source: SourceRef,
    previous: string,
    content: string,
  ): Promise<MonitorChange[]> {
    const sections = addedSections(previous, content);
    if (sections.length === 0) return [];

    // A changelog grows by a slice at a time. When most of the page is new at
    // once, its markup or SyncLab's extraction changed rather than the notes,
    // and classifying it would report years of history as new changes.
    const added = sections.reduce((count, section) => count + section.lines.length, 0);
    const total = content.split('\n').filter((line) => line !== '').length;
    if (added > REBASELINE_MIN_LINES && added > total * REBASELINE_SHARE) {
      this.logger.warn(
        `${source.url}: ${added} of ${total} lines are new at once; storing it as a new baseline without classifying`,
      );
      return [];
    }
    if (!this.sandbox) {
      throw new Error('Release notes need the classify sandbox phase, which only workers run');
    }

    const text = sections
      .map((section) =>
        [section.section ? `## ${section.section}` : '', ...section.lines]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n');
    const input: SandboxClassifyInput = {
      provider: (source.provider?.slug ?? 'anthropic') as SandboxClassifyInput['provider'],
      sourceKind: source.kind as SandboxClassifyInput['sourceKind'],
      url: source.url,
      text,
    };
    const outcome = await this.sandbox.classify(input);
    if (!outcome.ok) {
      throw new Error(`Classifying the new notes failed: ${outcome.error ?? 'unknown error'}`);
    }

    const { changes, dropped } = verifyClassified(outcome.changes, content);
    if (dropped.length > 0) {
      this.logger.warn(
        `${source.url}: dropped ${dropped.length} classified change(s): ${dropped.map((item) => item.reason).join('; ')}`,
      );
    }
    return changes.map((change) => ({
      ...change,
      section:
        sections.find((section) => section.lines.some((line) => line.includes(change.evidence)))
          ?.section || null,
    }));
  }

  /**
   * Creates the changes not seen before and updates the ones whose details
   * moved (a retirement date pushed back, a replacement named). A change that
   * was dismissed keeps its status, and one that disappears from the page is
   * kept: a provider tidying its page does not un-retire a model. A change
   * read by the classifier never rewrites an existing one, so a model's
   * reading cannot replace the evidence of a table or the spec.
   */
  private async applyChanges(
    tx: Pick<PrismaService, 'breakingChange'>,
    providerId: string,
    snapshotId: string,
    read: ReadChanges,
  ): Promise<{ created: number; updated: number }> {
    const { changes, status } = read;
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
      const mapKey = `${change.kind}:${key}`;
      const row = byKey.get(mapKey);

      if (!row) {
        const createdRow = await tx.breakingChange.create({
          data: {
            providerId,
            snapshotId,
            kind: change.kind,
            operation: change.operation,
            field: change.field,
            subjectKey: key,
            status,
            ...details,
          },
        });
        // The classifier can name the same change twice in one answer.
        byKey.set(mapKey, createdRow);
        created++;
        continue;
      }
      if (status === BreakingChangeStatus.DETECTED) continue;

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

/**
 * The format each reader parses. Asking for exactly that matters: the docs
 * sites answer a request that also accepts markdown with markdown, which has
 * no tables to read.
 */
export function acceptFor(kind: string): string {
  switch (kind) {
    case 'spec':
      return 'application/json';
    case 'sdk_changelog':
      return 'text/plain, text/markdown';
    default:
      return 'text/html';
  }
}

/** What a snapshot stores for each kind of source: the part its reader parses. */
export function contentOf(kind: string, body: string): string {
  switch (kind) {
    case 'deprecations':
      return normalizeTables(extractTables(body));
    case 'spec':
      return extractSurface(JSON.parse(body));
    case 'release_notes':
      return extractText(body, 'html');
    case 'sdk_changelog':
      return extractText(body, 'markdown');
    default:
      throw new Error(`Unknown source kind ${kind}`);
  }
}
