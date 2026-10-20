import type { Caller } from '../gateway/api-auth.guard';
import { ImpactService } from './impact.service';

const SERVICE: Caller = { kind: 'service' };

function user(ids: bigint[]): Caller {
  return {
    kind: 'user',
    login: 'octocat',
    repositories: new Map(
      ids.map((id) => [
        id,
        { githubRepoId: id, fullName: 'acme/api', installationId: 1n, private: false },
      ]),
    ),
  };
}

describe('ImpactService', () => {
  it('drops impacts for a change that is no longer confirmed', async () => {
    const tx = fakeTx({ changes: [] });
    const service = new ImpactService(prismaOf(tx) as never);

    await service.recomputeChange('change-1');

    expect(tx.apiImpact.deleteMany).toHaveBeenCalledWith({
      where: { breakingChangeId: 'change-1' },
    });
    expect(tx.apiImpact.createMany).not.toHaveBeenCalled();
  });

  it('replaces one repository from its newest completed scan', async () => {
    const tx = fakeTx({
      changes: [
        {
          id: 'change-1',
          providerId: 'openai',
          kind: 'model_retired',
          operation: null,
          field: 'gpt-4o',
        },
      ],
      scans: [
        {
          repositoryId: 'repo-1',
          usages: [
            {
              providerId: 'openai',
              file: 'src/chat.ts',
              operation: 'POST /v1/chat/completions',
              params: ['model'],
              modelIds: ['gpt-4o'],
              dynamic: false,
            },
          ],
        },
      ],
    });
    const service = new ImpactService({} as never);

    await service.recomputeRepository('repo-1', tx as never);

    expect(tx.apiImpact.deleteMany).toHaveBeenCalledWith({ where: { repositoryId: 'repo-1' } });
    expect(tx.apiImpact.createMany).toHaveBeenCalledWith({
      data: [
        {
          breakingChangeId: 'change-1',
          repositoryId: 'repo-1',
          confidence: 'confirmed',
          files: ['src/chat.ts'],
        },
      ],
    });
  });

  it('answers 404 for an unknown change and hides repositories the user cannot reach', async () => {
    const prisma = {
      breakingChange: { findUnique: jest.fn().mockResolvedValue(null) },
      apiImpact: { findMany: jest.fn() },
    };
    const service = new ImpactService(prisma as never);

    await expect(service.list('missing', SERVICE)).resolves.toBeNull();
    expect(prisma.apiImpact.findMany).not.toHaveBeenCalled();

    prisma.breakingChange.findUnique.mockResolvedValue({ id: 'change-1' });
    await expect(service.list('change-1', user([]))).resolves.toEqual({
      changeId: 'change-1',
      impacts: [],
    });
    expect(prisma.apiImpact.findMany).not.toHaveBeenCalled();

    prisma.apiImpact.findMany.mockResolvedValue([
      {
        repositoryId: 'repo-1',
        confidence: 'possible',
        files: ['src/a.ts'],
        repository: { githubRepoId: 7n, fullName: 'acme/api' },
      },
    ]);
    await expect(service.list('change-1', user([7n]))).resolves.toEqual({
      changeId: 'change-1',
      impacts: [
        {
          repositoryId: 'repo-1',
          githubRepoId: '7',
          fullName: 'acme/api',
          confidence: 'possible',
          files: ['src/a.ts'],
        },
      ],
    });
    expect(prisma.apiImpact.findMany).toHaveBeenCalledWith({
      where: { breakingChangeId: 'change-1', repository: { githubRepoId: { in: [7n] } } },
      include: { repository: true },
    });
  });
});

function prismaOf(tx: ReturnType<typeof fakeTx>) {
  return { $transaction: (fn: (db: unknown) => Promise<void>) => fn(tx) };
}

function fakeTx(data: { changes: unknown[]; scans?: unknown[] }) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(0),
    breakingChange: { findMany: jest.fn().mockResolvedValue(data.changes) },
    repositoryScan: { findMany: jest.fn().mockResolvedValue(data.scans ?? []) },
    apiImpact: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}
