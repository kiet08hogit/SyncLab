import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { acceptFor, ApiMonitorService, contentOf } from './api-monitor.service';

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
function setup(kind = 'deprecations', sandbox?: { classify: jest.Mock }) {
  const source = {
    id: 'source-1',
    providerId: 'anthropic-id',
    provider: { slug: 'anthropic' },
    kind,
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
  let inSnapshot = false;
  const recomputeAll = jest.fn(() => {
    if (inSnapshot) {
      return Promise.reject(new Error('impact recomputed inside the snapshot transaction'));
    }
    return Promise.resolve();
  });
  const client = {
    ...prisma,
    $transaction: jest.fn(async <T>(fn: (tx: typeof prisma) => Promise<T>) => {
      inSnapshot = true;
      try {
        return await fn(prisma);
      } finally {
        inSnapshot = false;
      }
    }),
  };

  const service = new ApiMonitorService(
    client as never,
    { recomputeAll } as never,
    sandbox as never,
  );
  return { service, prisma, source, snapshots, changes, recomputeAll };
}

const BEFORE = recorded('anthropic-deprecations-2026-09-26.html.gz');
const SPEC_BEFORE = recorded('openai-openapi-35060f5b.json.gz');
const SPEC_AFTER = recorded('openai-openapi-6ca9cb2b.json.gz');
const CHANGELOG_BEFORE = recorded('anthropic-sdk-changelog-4951de02.md.gz');
const CHANGELOG_AFTER = recorded('anthropic-sdk-changelog-4140e0ea.md.gz');
const CLASSIFIED = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'anthropic-sdk-changelog-0.123.0.classified.json'),
    'utf8',
  ),
) as { changes: unknown[] };
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

  it('recomputes impact after confirmed changes are stored, not after an update or a repeat', async () => {
    const { service, source, recomputeAll } = setup();
    service.useFetcher(() => Promise.resolve(BEFORE));

    await service.pollSource(source, day('2026-09-26'));
    expect(recomputeAll).toHaveBeenCalledTimes(1);

    recomputeAll.mockClear();
    service.useFetcher(() => Promise.resolve(AFTER));
    const added = await service.pollSource(source, day('2026-10-01'));
    expect(added.created).toBeGreaterThan(0);
    expect(recomputeAll).toHaveBeenCalledTimes(1);

    recomputeAll.mockClear();
    service.useFetcher(() =>
      Promise.resolve(AFTER.replaceAll('November 30, 2026', 'December 15, 2026')),
    );
    const moved = await service.pollSource(source, day('2026-10-05'));
    expect(moved).toMatchObject({ created: 0, updated: 1 });
    expect(recomputeAll).not.toHaveBeenCalled();

    const again = await service.pollSource(source, day('2026-10-06'));
    expect(again).toMatchObject({ changed: false, created: 0 });
    expect(recomputeAll).not.toHaveBeenCalled();
  });

  it('retries impact recompute on the next unchanged poll when the previous one failed', async () => {
    const { service, source, snapshots, recomputeAll } = setup();
    service.useFetcher(() => Promise.resolve(BEFORE));
    recomputeAll.mockRejectedValueOnce(new Error('impact recompute failed'));

    const failed = await service.pollSource(source, day('2026-09-26'));
    expect(failed.error).toBe('impact recompute failed');
    expect(source.lastError).toBe('impact recompute failed');
    expect(snapshots).toHaveLength(1);

    recomputeAll.mockRejectedValueOnce(new Error('impact recompute failed again'));
    const still = await service.pollSource(source, day('2026-09-27'));
    expect(still).toMatchObject({ changed: false });
    expect(still.error).toBe('impact recompute failed again');
    expect(source.lastError).toBe('impact recompute failed again');
    expect(snapshots).toHaveLength(1);

    const retried = await service.pollSource(source, day('2026-09-28'));
    expect(retried).toMatchObject({ changed: false, created: 0, updated: 0 });
    expect(retried.error).toBeUndefined();
    expect(source.lastError).toBeNull();
    expect(recomputeAll).toHaveBeenCalledTimes(3);
  });

  it('retries a failed impact recompute when the next poll creates no confirmed change', async () => {
    const { service, source, recomputeAll } = setup();
    service.useFetcher(() => Promise.resolve(AFTER));
    recomputeAll.mockRejectedValueOnce(new Error('impact recompute failed'));
    await service.pollSource(source, day('2026-10-01'));

    service.useFetcher(() =>
      Promise.resolve(AFTER.replaceAll('November 30, 2026', 'December 15, 2026')),
    );
    const moved = await service.pollSource(source, day('2026-10-05'));

    expect(moved).toMatchObject({ changed: true, created: 0, updated: 1 });
    expect(moved.error).toBeUndefined();
    expect(recomputeAll).toHaveBeenCalledTimes(2);
    expect(source.lastError).toBeNull();
  });

  it('retries a failed impact recompute when a poll loses the snapshot race', async () => {
    const { service, source, prisma, recomputeAll } = setup();
    service.useFetcher(() => Promise.resolve(AFTER));
    recomputeAll.mockRejectedValueOnce(new Error('impact recompute failed'));
    await service.pollSource(source, day('2026-10-01'));

    prisma.apiSourceSnapshot.findFirst.mockResolvedValueOnce(null as never);
    const second = await service.pollSource(source, day('2026-10-01'));

    expect(second).toMatchObject({ changed: false, created: 0, updated: 0 });
    expect(second.error).toBeUndefined();
    expect(recomputeAll).toHaveBeenCalledTimes(2);
    expect(source.lastError).toBeNull();
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
    const { service, source, snapshots, changes, prisma, recomputeAll } = setup();
    service.useFetcher(() => Promise.resolve(AFTER));
    await service.pollSource(source, day('2026-10-01'));
    const rowsBefore = JSON.stringify(changes);
    recomputeAll.mockClear();
    // This poll read the latest hash before the other poll committed its snapshot.
    prisma.apiSourceSnapshot.findFirst.mockResolvedValueOnce(null as never);

    const second = await service.pollSource(source, day('2026-10-01'));

    expect(second).toMatchObject({ changed: false, created: 0, updated: 0 });
    expect(recomputeAll).not.toHaveBeenCalled();
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

  it('asks each kind of source for the format its reader parses', async () => {
    const { service, source } = setup();
    const fetcher = jest.fn().mockResolvedValue(AFTER);
    service.useFetcher(fetcher);

    await service.pollSource(source, day('2026-10-01'));

    // A docs page offered markdown answers with markdown, which has no tables.
    expect(fetcher).toHaveBeenCalledWith(source.url, 'text/html');
    expect(acceptFor('spec')).toBe('application/json');
    expect(acceptFor('release_notes')).toBe('text/html');
    expect(acceptFor('sdk_changelog')).toMatch(/text\/plain/);
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

  describe('the OpenAI spec', () => {
    it('stores the first spec as a baseline and turns the real spend_control removal into two confirmed changes', async () => {
      const { service, source, changes, snapshots, recomputeAll } = setup('spec');

      service.useFetcher(() => Promise.resolve(SPEC_BEFORE));
      const baseline = await service.pollSource(source, day('2026-10-15'));
      expect(baseline).toMatchObject({ changed: true, created: 0 });
      expect(recomputeAll).not.toHaveBeenCalled();

      service.useFetcher(() => Promise.resolve(SPEC_AFTER));
      const next = await service.pollSource(source, day('2026-10-16'));

      expect(next).toMatchObject({ changed: true, created: 2, updated: 0 });
      expect(recomputeAll).toHaveBeenCalledTimes(1);
      expect(snapshots).toHaveLength(2);
      expect(
        changes.map(({ kind, operation, field, status }) => ({ kind, operation, field, status })),
      ).toEqual([
        {
          kind: 'param_removed',
          operation: 'POST /v1/agents/sessions',
          field: 'spend_control',
          status: 'confirmed',
        },
        {
          kind: 'param_removed',
          operation: 'POST /v1/agents/sessions/{session_id}',
          field: 'spend_control',
          status: 'confirmed',
        },
      ]);
    });

    it('records a body that is not an OpenAPI document as an error', async () => {
      const { service, source, snapshots } = setup('spec');
      service.useFetcher(() => Promise.resolve('{"hello":"world"}'));

      const result = await service.pollSource(source, day('2026-10-15'));

      expect(result.error).toMatch(/OpenAPI/);
      expect(snapshots).toHaveLength(0);
    });
  });

  describe('release notes and changelogs', () => {
    const classifier = (answer: unknown) => ({
      classify: jest.fn().mockResolvedValue({ ok: true, changes: answer, output: '' }),
    });

    it('does not classify the first snapshot of a source', async () => {
      const sandbox = classifier([]);
      const { service, source, snapshots } = setup('sdk_changelog', sandbox);
      service.useFetcher(() => Promise.resolve(CHANGELOG_BEFORE));

      await expect(service.pollSource(source, day('2026-08-31'))).resolves.toMatchObject({
        changed: true,
        created: 0,
      });
      expect(sandbox.classify).not.toHaveBeenCalled();
      expect(snapshots).toHaveLength(1);
    });

    it('classifies only the lines a release added and keeps only changes quoted verbatim, as detected', async () => {
      const sandbox = classifier(CLASSIFIED.changes);
      const { service, source, changes, recomputeAll } = setup('sdk_changelog', sandbox);
      service.useFetcher(() => Promise.resolve(CHANGELOG_BEFORE));
      await service.pollSource(source, day('2026-08-31'));
      service.useFetcher(() => Promise.resolve(CHANGELOG_AFTER));

      const result = await service.pollSource(source, day('2026-09-01'));

      const [input] = sandbox.classify.mock.calls[0] as [
        { provider: string; sourceKind: string; text: string },
      ];
      expect(input).toMatchObject({ provider: 'anthropic', sourceKind: 'sdk_changelog' });
      expect(input.text).toContain('remove relationship in favor of access_type');
      expect(input.text).toContain('## Changelog / 0.123.0 (2026-09-01)');
      // Nothing the previous snapshot already had, apart from the section headings.
      const known = new Set(contentOf('sdk_changelog', CHANGELOG_BEFORE).split('\n'));
      const sent = input.text.split('\n').filter((line) => line !== '' && !line.startsWith('## '));
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.filter((line) => known.has(line))).toEqual([]);

      expect(result).toMatchObject({ changed: true, created: 1 });
      expect(changes[0]?.status).toBe('detected');
      expect(recomputeAll).not.toHaveBeenCalled();
      expect(changes).toEqual([
        expect.objectContaining({
          kind: 'param_renamed',
          field: 'relationship',
          replacement: 'access_type',
          status: 'detected',
          section: 'Changelog / 0.123.0 (2026-09-01) / Features',
          evidence:
            'beta user profiles: add external_user_onboarded_at, remove relationship in favor of access_type',
        }),
      ]);
    });

    it('replays a recorded Gemini answer for the real 0.123.0 release into one detected change', async () => {
      const recordedAnswer = JSON.parse(
        readFileSync(
          join(__dirname, 'fixtures', 'anthropic-sdk-changelog-0.123.0.gemini.json'),
          'utf8',
        ),
      ) as { changes: unknown[] };
      const { service, source, changes } = setup(
        'sdk_changelog',
        classifier(recordedAnswer.changes),
      );
      service.useFetcher(() => Promise.resolve(CHANGELOG_BEFORE));
      await service.pollSource(source, day('2026-08-31'));
      service.useFetcher(() => Promise.resolve(CHANGELOG_AFTER));

      await service.pollSource(source, day('2026-09-01'));

      expect(changes).toEqual([
        expect.objectContaining({
          kind: 'param_removed',
          field: 'relationship',
          replacement: 'access_type',
          effectiveAt: new Date('2026-09-01T00:00:00Z'),
          status: 'detected',
          section: 'Changelog / 0.123.0 (2026-09-01) / Features',
        }),
      ]);
    });

    it('stores nothing when classification fails, so the next poll tries the same lines again', async () => {
      const sandbox = { classify: jest.fn() };
      const { service, source, snapshots, changes } = setup('sdk_changelog', sandbox);
      sandbox.classify.mockResolvedValue({ ok: true, changes: [], output: '' });
      service.useFetcher(() => Promise.resolve(CHANGELOG_BEFORE));
      await service.pollSource(source, day('2026-08-31'));

      sandbox.classify.mockResolvedValueOnce({
        ok: false,
        error: 'model call failed: connect ECONNREFUSED',
        changes: [],
        output: '',
      });
      service.useFetcher(() => Promise.resolve(CHANGELOG_AFTER));
      const failed = await service.pollSource(source, day('2026-09-01'));

      expect(failed.error).toMatch(/ECONNREFUSED/);
      expect(source.lastError).toMatch(/ECONNREFUSED/);
      expect(snapshots).toHaveLength(1);

      sandbox.classify.mockResolvedValueOnce({ ok: true, changes: CLASSIFIED.changes, output: '' });
      const retried = await service.pollSource(source, day('2026-09-01'));

      expect(retried).toMatchObject({ changed: true, created: 1 });
      expect(snapshots).toHaveLength(2);
      expect(changes).toHaveLength(1);
      expect(source.lastError).toBeNull();
    });

    it('never lets a classified change rewrite one the providers published', async () => {
      const sandbox = classifier([
        {
          kind: 'param_renamed',
          operation: null,
          field: 'relationship',
          replacement: 'something-else',
          effectiveAt: null,
          evidence:
            'beta user profiles: add external_user_onboarded_at, remove relationship in favor of access_type',
        },
      ]);
      const { service, source, changes } = setup('sdk_changelog', sandbox);
      changes.push({
        id: 'change-0',
        providerId: 'anthropic-id',
        snapshotId: 'older',
        kind: 'param_renamed',
        operation: null,
        field: 'relationship',
        replacement: 'access_type',
        effectiveAt: null,
        section: 'from a table',
        evidence: 'the original evidence',
        status: 'confirmed',
        subjectKey: '|relationship',
      });
      service.useFetcher(() => Promise.resolve(CHANGELOG_BEFORE));
      await service.pollSource(source, day('2026-08-31'));
      service.useFetcher(() => Promise.resolve(CHANGELOG_AFTER));

      const result = await service.pollSource(source, day('2026-09-01'));

      expect(result).toMatchObject({ created: 0, updated: 0 });
      expect(changes[0]).toMatchObject({
        replacement: 'access_type',
        evidence: 'the original evidence',
        status: 'confirmed',
      });
    });

    it('re-baselines without classifying when most of the page is new at once', async () => {
      const sandbox = classifier(CLASSIFIED.changes);
      const { service, source, snapshots, changes } = setup('sdk_changelog', sandbox);
      // The same notes, but the first snapshot was read in another shape.
      service.useFetcher(() => Promise.resolve('# Changelog\n\n## 0.1.0\n\n* initial release'));
      await service.pollSource(source, day('2026-08-31'));
      service.useFetcher(() => Promise.resolve(CHANGELOG_AFTER));

      const result = await service.pollSource(source, day('2026-09-01'));

      expect(result).toMatchObject({ changed: true, created: 0 });
      expect(sandbox.classify).not.toHaveBeenCalled();
      expect(snapshots).toHaveLength(2);
      expect(changes).toHaveLength(0);
    });

    it('needs a worker to classify', async () => {
      const { service, source } = setup('sdk_changelog');
      service.useFetcher(() => Promise.resolve(CHANGELOG_BEFORE));
      await service.pollSource(source, day('2026-08-31'));
      service.useFetcher(() => Promise.resolve(CHANGELOG_AFTER));

      const result = await service.pollSource(source, day('2026-09-01'));

      expect(result.error).toMatch(/only workers run/);
    });
  });
});
