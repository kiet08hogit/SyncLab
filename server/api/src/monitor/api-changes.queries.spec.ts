import { ApiChangesQueries } from './api-changes.queries';

const SOURCE = {
  id: 'source-1',
  kind: 'deprecations',
  url: 'https://platform.claude.com/docs/en/about-claude/model-deprecations',
  lastCheckedAt: new Date('2026-10-17T06:00:00Z'),
  lastError: null,
};

function setup() {
  const prisma = {
    apiProvider: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'anthropic-id',
          slug: 'anthropic',
          sources: [
            {
              ...SOURCE,
              snapshots: [
                { id: 'snap-2', contentHash: 'abc', fetchedAt: new Date('2026-10-01T14:35:59Z') },
              ],
            },
          ],
        },
        {
          id: 'openai-id',
          slug: 'openai',
          sources: [
            {
              ...SOURCE,
              id: 'source-2',
              url: 'https://developers.openai.com/api/docs/deprecations',
              lastCheckedAt: null,
              lastError: 'GET returned 503',
              snapshots: [],
            },
          ],
        },
      ]),
    },
    breakingChange: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([
        { providerId: 'anthropic-id', status: 'confirmed', _count: { _all: 20 } },
        { providerId: 'anthropic-id', status: 'dismissed', _count: { _all: 1 } },
      ]),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'change-1',
          provider: { slug: 'anthropic' },
          kind: 'model_retired',
          operation: null,
          field: 'claude-sonnet-4-5-20250929',
          replacement: 'claude-sonnet-5-5',
          effectiveAt: new Date('2026-11-30T00:00:00Z'),
          section: '2026-09-30: Claude Sonnet 4.5 model',
          evidence: 'November 30, 2026 | claude-sonnet-4-5-20250929 | claude-sonnet-5-5',
          status: 'confirmed',
          snapshotId: 'snap-2',
          snapshot: { source: SOURCE },
          detectedAt: new Date('2026-10-01T14:36:02Z'),
          updatedAt: new Date('2026-10-01T14:36:02Z'),
        },
      ]),
    },
  };
  return { prisma, queries: new ApiChangesQueries(prisma as never) };
}

describe('ApiChangesQueries', () => {
  it('lists providers with their sources, latest snapshots and every status count', async () => {
    const { queries } = setup();

    await expect(queries.listProviders()).resolves.toEqual([
      {
        slug: 'anthropic',
        sources: [
          {
            kind: 'deprecations',
            url: SOURCE.url,
            lastCheckedAt: '2026-10-17T06:00:00.000Z',
            lastError: null,
            latestSnapshot: {
              id: 'snap-2',
              contentHash: 'abc',
              fetchedAt: '2026-10-01T14:35:59.000Z',
            },
          },
        ],
        changeCounts: { detected: 0, confirmed: 20, dismissed: 1 },
      },
      {
        slug: 'openai',
        sources: [
          {
            kind: 'deprecations',
            url: 'https://developers.openai.com/api/docs/deprecations',
            lastCheckedAt: null,
            lastError: 'GET returned 503',
            latestSnapshot: null,
          },
        ],
        changeCounts: { detected: 0, confirmed: 0, dismissed: 0 },
      },
    ]);
  });

  it('returns changes in the documented shape, with a calendar date for effectiveAt', async () => {
    const { queries } = setup();

    await expect(queries.listChanges({})).resolves.toEqual([
      {
        id: 'change-1',
        provider: 'anthropic',
        kind: 'model_retired',
        operation: null,
        field: 'claude-sonnet-4-5-20250929',
        replacement: 'claude-sonnet-5-5',
        effectiveAt: '2026-11-30',
        section: '2026-09-30: Claude Sonnet 4.5 model',
        evidence: 'November 30, 2026 | claude-sonnet-4-5-20250929 | claude-sonnet-5-5',
        status: 'confirmed',
        source: { kind: 'deprecations', url: SOURCE.url },
        snapshotId: 'snap-2',
        detectedAt: '2026-10-01T14:36:02.000Z',
        updatedAt: '2026-10-01T14:36:02.000Z',
      },
    ]);
  });

  it('filters on provider slug, status and kind, newest first', async () => {
    const { queries, prisma } = setup();

    await queries.listChanges({ provider: 'openai', status: 'detected', kind: 'endpoint_removed' });

    expect(prisma.breakingChange.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider: { slug: 'openai' }, status: 'detected', kind: 'endpoint_removed' },
        orderBy: [{ detectedAt: 'desc' }, { id: 'asc' }],
      }),
    );
  });

  it('sets a status and returns the change in the list shape', async () => {
    const { queries, prisma } = setup();
    const [row] = (await prisma.breakingChange.findMany()) as Array<Record<string, unknown>>;
    prisma.breakingChange.findUniqueOrThrow.mockResolvedValue({ ...row, status: 'dismissed' });

    const change = await queries.setStatus('change-1', 'dismissed');

    expect(prisma.breakingChange.updateMany).toHaveBeenCalledWith({
      where: { id: 'change-1' },
      data: { status: 'dismissed' },
    });
    expect(change).toMatchObject({
      id: 'change-1',
      status: 'dismissed',
      effectiveAt: '2026-11-30',
    });
  });

  it('returns null for an unknown change without reading it back', async () => {
    const { queries, prisma } = setup();
    prisma.breakingChange.updateMany.mockResolvedValue({ count: 0 });

    await expect(queries.setStatus('missing', 'confirmed')).resolves.toBeNull();
    expect(prisma.breakingChange.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
