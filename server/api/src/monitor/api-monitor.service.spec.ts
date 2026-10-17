import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ApiMonitorService } from './api-monitor.service';

function recorded(name: string): string {
  return gunzipSync(readFileSync(join(__dirname, 'fixtures', name))).toString('utf8');
}

interface ChangeRow {
  id: string;
  providerId: string;
  snapshotId: string;
  kind: string;
  operation: string | null;
  field: string | null;
  replacement: string | null;
  effectiveAt: Date | null;
  section: string | null;
  evidence: string;
  status: string;
  subjectKey: string;
}

/**
 * The three tables the monitor writes, in memory, enforcing the same unique
 * key as breaking_changes so a duplicate insert fails like it would in Postgres.
 */
function setup() {
  const source = {
    id: 'source-1',
    providerId: 'anthropic-id',
    kind: 'deprecations',
    url: 'https://platform.claude.com/docs/en/about-claude/model-deprecations',
    lastCheckedAt: null as Date | null,
    lastError: null as string | null,
    createdAt: new Date(0),
  };
  const snapshots: Array<{
    id: string;
    sourceId: string;
    contentHash: string;
    content: string;
    fetchedAt: Date;
  }> = [];
  const changes: ChangeRow[] = [];

  const prisma = {
    $executeRaw: jest.fn(() => Promise.resolve(1)),
    apiSource: {
      findMany: jest.fn(() => Promise.resolve([source])),
      update: jest.fn((args: { data: Partial<typeof source> }) => {
        Object.assign(source, args.data);
        return Promise.resolve(source);
      }),
    },
    apiSourceSnapshot: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          [...snapshots].sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())[0] ?? null,
        ),
      ),
      create: jest.fn((args: { data: Omit<(typeof snapshots)[number], 'id'> }) => {
        const row = { id: `snapshot-${snapshots.length + 1}`, ...args.data };
        snapshots.push(row);
        return Promise.resolve(row);
      }),
    },
    breakingChange: {
      findMany: jest.fn((args: { where: { providerId: string; subjectKey: { in: string[] } } }) =>
        Promise.resolve(
          changes.filter(
            (row) =>
              row.providerId === args.where.providerId &&
              args.where.subjectKey.in.includes(row.subjectKey),
          ),
        ),
      ),
      create: jest.fn((args: { data: Omit<ChangeRow, 'id'> }) => {
        const duplicate = changes.some(
          (row) =>
            row.providerId === args.data.providerId &&
            row.kind === args.data.kind &&
            row.subjectKey === args.data.subjectKey,
        );
        if (duplicate) return Promise.reject(new Error('unique constraint failed'));
        const row = { id: `change-${changes.length + 1}`, ...args.data };
        changes.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn((args: { where: { id: string }; data: Partial<ChangeRow> }) => {
        const row = changes.find((candidate) => candidate.id === args.where.id)!;
        Object.assign(row, args.data);
        return Promise.resolve(row);
      }),
    },
  };
  const client = {
    ...prisma,
    $transaction: jest.fn(<T>(fn: (tx: typeof prisma) => Promise<T>) => fn(prisma)),
  };

  const service = new ApiMonitorService(client as never);
  return { service, prisma, source, snapshots, changes };
}

const BEFORE = recorded('anthropic-deprecations-2026-09-26.html.gz');
const AFTER = recorded('anthropic-deprecations-2026-10-01.html.gz');
const day = (date: string) => new Date(`${date}T12:00:00Z`);

describe('ApiMonitorService', () => {
  it('replays a real retirement announcement into exactly the expected records', async () => {
    const { service, source, changes } = setup();

    service.useFetcher(() => Promise.resolve(BEFORE));
    const first = await service.pollSource(source, day('2026-09-26'));
    const knownIds = new Set(changes.map((row) => row.id));

    service.useFetcher(() => Promise.resolve(AFTER));
    const second = await service.pollSource(source, day('2026-10-01'));

    expect(first).toMatchObject({ changed: true, created: 19, updated: 0 });
    expect(second).toMatchObject({ changed: true, created: 1, updated: 0 });
    expect(changes.filter((row) => !knownIds.has(row.id))).toEqual([
      {
        id: 'change-20',
        providerId: 'anthropic-id',
        snapshotId: 'snapshot-2',
        kind: 'model_retired',
        operation: null,
        field: 'claude-sonnet-4-5-20250929',
        subjectKey: '|claude-sonnet-4-5-20250929',
        status: 'confirmed',
        replacement: 'claude-sonnet-5-5',
        effectiveAt: new Date('2026-11-30T00:00:00Z'),
        section: '2026-09-30: Claude Sonnet 4.5 model',
        evidence: 'November 30, 2026 | claude-sonnet-4-5-20250929 | claude-sonnet-5-5',
      },
    ]);
    // Read from the providers' own retirement tables, so confirmed without review.
    expect(changes.every((row) => row.status === 'confirmed')).toBe(true);
  });

  it('stores nothing and changes nothing when the page has not changed', async () => {
    const { service, source, snapshots, changes, prisma } = setup();
    service.useFetcher(() => Promise.resolve(AFTER));
    await service.pollSource(source, day('2026-10-01'));
    const rowsBefore = JSON.stringify(changes);

    const again = await service.pollSource(source, day('2026-10-02'));

    expect(again).toMatchObject({ changed: false, created: 0, updated: 0 });
    expect(snapshots).toHaveLength(1);
    expect(JSON.stringify(changes)).toBe(rowsBefore);
    expect(source.lastCheckedAt).toEqual(day('2026-10-02'));
    expect(prisma.breakingChange.create).toHaveBeenCalledTimes(20);
  });

  it('stores nothing when another poll recorded the same page while this one waited', async () => {
    const { service, source, snapshots, changes, prisma } = setup();
    service.useFetcher(() => Promise.resolve(AFTER));
    await service.pollSource(source, day('2026-10-01'));
    const rowsBefore = JSON.stringify(changes);
    // This poll read the latest hash before the other poll committed its snapshot.
    prisma.apiSourceSnapshot.findFirst.mockResolvedValueOnce(null as never);

    const second = await service.pollSource(source, day('2026-10-01'));

    expect(second).toMatchObject({ changed: false, created: 0, updated: 0 });
    expect(second.error).toBeUndefined();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(snapshots).toHaveLength(1);
    expect(JSON.stringify(changes)).toBe(rowsBefore);
    expect(source.lastError).toBeNull();
  });

  it('treats a change in page chrome alone as no change', async () => {
    const { service, source, snapshots } = setup();
    service.useFetcher(() => Promise.resolve(AFTER));
    await service.pollSource(source, day('2026-10-01'));

    service.useFetcher(() =>
      Promise.resolve(AFTER.replace('</body>', '<script>window.__BUILD__="next"</script></body>')),
    );
    const again = await service.pollSource(source, day('2026-10-02'));

    expect(again.changed).toBe(false);
    expect(snapshots).toHaveLength(1);
  });

  it('updates a retirement whose date moved, without touching the others', async () => {
    const { service, source, changes } = setup();
    service.useFetcher(() => Promise.resolve(AFTER));
    await service.pollSource(source, day('2026-10-01'));

    service.useFetcher(() =>
      Promise.resolve(AFTER.replaceAll('November 30, 2026', 'December 15, 2026')),
    );
    const moved = await service.pollSource(source, day('2026-10-05'));

    expect(moved).toMatchObject({ changed: true, created: 0, updated: 1 });
    const sonnet = changes.find((row) => row.field === 'claude-sonnet-4-5-20250929')!;
    expect(sonnet.effectiveAt).toEqual(new Date('2026-12-15T00:00:00Z'));
    expect(sonnet.snapshotId).toBe('snapshot-2');
    expect(changes.filter((row) => row.snapshotId === 'snapshot-2')).toHaveLength(1);
  });

  it('keeps a dismissed change dismissed when its details are read again', async () => {
    const { service, source, changes } = setup();
    service.useFetcher(() => Promise.resolve(AFTER));
    await service.pollSource(source, day('2026-10-01'));
    changes.find((row) => row.field === 'claude-sonnet-4-5-20250929')!.status = 'dismissed';

    service.useFetcher(() =>
      Promise.resolve(AFTER.replaceAll('November 30, 2026', 'December 15, 2026')),
    );
    await service.pollSource(source, day('2026-10-05'));

    expect(changes.find((row) => row.field === 'claude-sonnet-4-5-20250929')!.status).toBe(
      'dismissed',
    );
  });

  it('keeps a retirement that later disappears from the page', async () => {
    const { service, source, changes } = setup();
    service.useFetcher(() => Promise.resolve(AFTER));
    await service.pollSource(source, day('2026-10-01'));

    service.useFetcher(() => Promise.resolve(BEFORE));
    const older = await service.pollSource(source, day('2026-10-02'));

    expect(older).toMatchObject({ changed: true, created: 0 });
    expect(changes.map((row) => row.field)).toContain('claude-sonnet-4-5-20250929');
  });

  it('records a page without retirement tables as an error instead of "nothing retired"', async () => {
    const { service, source, snapshots, changes } = setup();
    service.useFetcher(() =>
      Promise.resolve('<html><body><h1>We moved our docs</h1></body></html>'),
    );

    const result = await service.pollSource(source, day('2026-10-01'));

    expect(result.error).toMatch(/layout may have changed/);
    expect(source.lastError).toMatch(/layout may have changed/);
    expect(snapshots).toHaveLength(0);
    expect(changes).toHaveLength(0);
  });

  it('records a failed fetch on the source and carries on with the next one', async () => {
    const { service, source, prisma } = setup();
    service.useFetcher(() => Promise.reject(new Error('GET https://example returned 503')));

    const startedAt = Date.now();
    const [result] = await service.pollAll();

    expect(result).toMatchObject({ changed: false, error: 'GET https://example returned 503' });
    expect(source.lastError).toBe('GET https://example returned 503');
    // Stamped with the time of its own fetch.
    expect(source.lastCheckedAt!.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(prisma.apiSourceSnapshot.create).not.toHaveBeenCalled();
  });

  it('clears the previous error once a fetch succeeds', async () => {
    const { service, source } = setup();
    source.lastError = 'GET https://example returned 503';
    service.useFetcher(() => Promise.resolve(AFTER));

    await service.pollSource(source, day('2026-10-01'));

    expect(source.lastError).toBeNull();
  });
});
