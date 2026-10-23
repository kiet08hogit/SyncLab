import { UnrecoverableError } from 'bullmq';
import { JobStatus } from '../common/constants';
import { claimMigrationJob } from './claim-job';
import { MigrationProcessor } from './migration.processor';

jest.mock('./claim-job');

describe('MigrationProcessor', () => {
  it('takes its concurrency from configuration().worker.concurrency', () => {
    jest.isolateModules(() => {
      jest.doMock('../config/configuration', () => ({
        ...jest.requireActual<object>('../config/configuration'),
        configuration: () => ({ worker: { concurrency: 7 } }),
      }));

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require('./migration.processor') as { MigrationProcessor: object };
      expect(Reflect.getMetadata('bullmq:worker_metadata', fresh.MigrationProcessor)).toEqual({
        concurrency: 7,
      });
    });
  });

  it('fails without retry when the refactor produced no changes', async () => {
    jest.mocked(claimMigrationJob).mockResolvedValue({
      kind: 'claimed',
      record: {
        kind: 'dependency',
        dependencyName: 'widgets',
        targetVersion: 'v2.0.0',
        repository: { fullName: 'acme/widgets', installationId: 1n },
      },
    } as never);

    const prisma = {
      migrationJob: { update: jest.fn().mockResolvedValue(undefined) },
      executionLog: { createMany: jest.fn().mockResolvedValue(undefined) },
    };
    const sandbox = {
      ensureImage: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue({ ok: false, error: 'refactor produced no changes' }),
    };
    const githubToken = { getInstallationToken: jest.fn().mockResolvedValue('token') };
    const config = { get: jest.fn().mockReturnValue({ apiKey: 'key', maxAttempts: 1 }) };

    const processor = new MigrationProcessor(
      prisma as never,
      sandbox as never,
      githubToken as never,
      config as never,
    );

    await expect(
      processor.process({ data: { jobId: 'job-1', repoUrl: '' } } as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(prisma.migrationJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: JobStatus.FAILED, errorMessage: 'refactor produced no changes' },
    });
    const statuses = prisma.migrationJob.update.mock.calls.map(
      ([args]: [{ data: { status: string } }]) => args.data.status,
    );
    expect(statuses).not.toContain(JobStatus.COMPLETED);
  });

  describe('an api_change job', () => {
    const CHANGE = {
      id: '1b2c3d4e-0000-4000-8000-000000000000',
      status: 'confirmed',
      kind: 'model_retired',
      operation: 'POST /v1/messages',
      field: 'claude-3-opus-20240229',
      replacement: 'claude-opus-4-1',
      effectiveAt: new Date('2026-01-05T00:00:00Z'),
      evidence: 'Claude 3 Opus is retired on January 5, 2026.',
      provider: { slug: 'anthropic' },
      snapshot: {
        source: { url: 'https://docs.anthropic.com/en/docs/about-claude/model-deprecations' },
      },
    };

    function setup(
      change: unknown = CHANGE,
      impact: unknown = { confidence: 'confirmed', files: ['src/chat.ts', 'src/summary.ts'] },
    ) {
      jest.mocked(claimMigrationJob).mockResolvedValue({
        kind: 'claimed',
        record: {
          id: 'job-1',
          kind: 'api_change',
          repositoryId: 'repo-1',
          breakingChangeId: CHANGE.id,
          dependencyName: null,
          targetVersion: null,
          repository: { fullName: 'acme/widgets', installationId: 1n },
        },
      } as never);

      const prisma = {
        migrationJob: { update: jest.fn().mockResolvedValue(undefined) },
        executionLog: { createMany: jest.fn().mockResolvedValue(undefined) },
        breakingChange: { findUnique: jest.fn().mockResolvedValue(change) },
        apiImpact: { findUnique: jest.fn().mockResolvedValue(impact) },
      };
      const sandbox = {
        ensureImage: jest.fn().mockResolvedValue(undefined),
        run: jest.fn().mockResolvedValue({
          ok: true,
          pullRequestUrl: 'https://github.com/acme/widgets/pull/9',
        }),
      };
      const processor = new MigrationProcessor(
        prisma as never,
        sandbox as never,
        { getInstallationToken: jest.fn().mockResolvedValue('token') } as never,
        { get: jest.fn().mockReturnValue({ apiKey: 'key', maxAttempts: 1 }) } as never,
      );
      const job = { data: { jobId: 'job-1', repoUrl: '' } } as never;
      return { processor, prisma, sandbox, job };
    }

    it('hands the sandbox the brief, the impact files and a branch named after the change', async () => {
      const { processor, prisma, sandbox, job } = setup();

      await processor.process(job);

      expect(prisma.apiImpact.findUnique).toHaveBeenCalledWith({
        where: {
          breakingChangeId_repositoryId: { breakingChangeId: CHANGE.id, repositoryId: 'repo-1' },
        },
      });
      const params = (sandbox.run.mock.calls[0] as unknown[])[1];
      expect(params).toMatchObject({
        migration: {
          kind: 'api_change',
          change: {
            provider: 'anthropic',
            kind: 'model_retired',
            operation: 'POST /v1/messages',
            field: 'claude-3-opus-20240229',
            replacement: 'claude-opus-4-1',
            effectiveAt: '2026-01-05',
            evidence: 'Claude 3 Opus is retired on January 5, 2026.',
            sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/model-deprecations',
          },
          files: ['src/chat.ts', 'src/summary.ts'],
        },
        branchName: 'synclab/api-anthropic-claude-3-opus-20240229-1b2c3d4e',
        validationContext: '{}',
      });
      expect(prisma.migrationJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          status: JobStatus.COMPLETED,
          pullRequestUrl: 'https://github.com/acme/widgets/pull/9',
          errorMessage: null,
        },
      });
    });

    it.each([
      [
        'dismissed since it was queued',
        { ...CHANGE, status: 'dismissed' },
        undefined,
        /no longer confirmed/,
      ],
      ['gone', null, undefined, /no longer confirmed/],
      [
        'behavior_changed, which is only reported',
        { ...CHANGE, kind: 'behavior_changed' },
        undefined,
        /reported, never migrated/,
      ],
      [
        'no longer confirmed by the latest scan',
        CHANGE,
        { confidence: 'possible', files: ['src/chat.ts'] },
        /no longer confirms/,
      ],
      ['no longer found by the latest scan', CHANGE, null, /no longer confirms/],
    ])(
      'fails for good without running the sandbox when the change is %s',
      async (_label, change, impact, message) => {
        const { processor, prisma, sandbox, job } = setup(
          change,
          impact === undefined ? undefined : impact,
        );

        await expect(processor.process(job)).rejects.toBeInstanceOf(UnrecoverableError);

        expect(sandbox.run).not.toHaveBeenCalled();
        expect(prisma.migrationJob.update).toHaveBeenCalledWith({
          where: { id: 'job-1' },
          data: {
            status: JobStatus.FAILED,
            errorMessage: expect.stringMatching(message) as unknown,
          },
        });
      },
    );
  });

  describe('a retryable sandbox failure', () => {
    function processorFailingWith(error: string) {
      jest.mocked(claimMigrationJob).mockResolvedValue({
        kind: 'claimed',
        record: {
          kind: 'dependency',
          dependencyName: 'widgets',
          targetVersion: 'v2.0.0',
          repository: { fullName: 'acme/widgets', installationId: 1n },
        },
      } as never);

      const prisma = {
        migrationJob: { update: jest.fn().mockResolvedValue(undefined) },
        executionLog: { createMany: jest.fn().mockResolvedValue(undefined) },
      };
      const sandbox = {
        ensureImage: jest.fn().mockResolvedValue(undefined),
        run: jest.fn().mockResolvedValue({ ok: false, error, retryable: true }),
      };
      const githubToken = { getInstallationToken: jest.fn().mockResolvedValue('token') };
      const config = { get: jest.fn().mockReturnValue({ apiKey: 'key', maxAttempts: 1 }) };
      const processor = new MigrationProcessor(
        prisma as never,
        sandbox as never,
        githubToken as never,
        config as never,
      );

      return { processor, prisma };
    }

    function attempt(attemptsMade: number) {
      return {
        data: { jobId: 'job-1', repoUrl: '' },
        attemptsMade,
        opts: { attempts: 3 },
      } as never;
    }

    it('keeps the job QUEUED while BullMQ still has attempts left', async () => {
      const { processor, prisma } = processorFailingWith('model rate limited');

      await expect(processor.process(attempt(0))).rejects.not.toBeInstanceOf(UnrecoverableError);

      // FAILED here would let a trigger during the backoff queue a second run.
      expect(prisma.migrationJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: JobStatus.QUEUED, errorMessage: 'model rate limited' },
      });
    });

    it('marks the job FAILED on the last attempt', async () => {
      const { processor, prisma } = processorFailingWith('model rate limited');

      await expect(processor.process(attempt(2))).rejects.toThrow('model rate limited');

      expect(prisma.migrationJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: JobStatus.FAILED, errorMessage: 'model rate limited' },
      });
    });
  });
});
