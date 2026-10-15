import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JobStatus, MIGRATION_JOB_NAME } from '../common/constants';
import { MigrationJobsService } from './migration-jobs.service';
import { WebhookController } from './webhook.controller';
import type { GithubReleasePayload } from './webhook.types';

const PAYLOAD: GithubReleasePayload = {
  action: 'published',
  release: { name: 'react', tag_name: 'v19.0.0' },
  repository: {
    id: 42,
    name: 'widgets',
    full_name: 'acme/widgets',
    clone_url: 'https://github.com/acme/widgets.git',
  },
  installation: { id: 7 },
};

const RETRY_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 120_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

function duplicateError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function setup(existing?: { id: string; status: string }) {
  const prisma = {
    repository: { upsert: jest.fn().mockResolvedValue({ id: 'repo-1' }) },
    migrationJob: {
      create: existing
        ? jest.fn().mockRejectedValue(duplicateError())
        : jest.fn().mockResolvedValue({ id: 'job-1', status: JobStatus.QUEUED }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(existing),
      // The row is still FAILED when the redelivery claims its retry.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const controller = new WebhookController(
    new MigrationJobsService(queue as never, prisma as never),
  );
  return { controller, prisma, queue };
}

describe('WebhookController', () => {
  it('answers a ping', async () => {
    const { controller, queue } = setup();
    await expect(controller.handleWebhook({}, 'ping')).resolves.toEqual({ ok: true });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('ignores events that are not a published release', async () => {
    const { controller, queue } = setup();
    await expect(
      controller.handleWebhook({ ...PAYLOAD, action: 'created' }, 'release'),
    ).resolves.toMatchObject({ ignored: true });
    await expect(controller.handleWebhook(PAYLOAD, 'push')).resolves.toMatchObject({
      ignored: true,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each([
    ['repository', { ...PAYLOAD, repository: undefined }],
    ['tag_name', { ...PAYLOAD, release: { name: 'react' } }],
    ['installation', { ...PAYLOAD, installation: undefined }],
  ])('rejects a payload missing %s', async (_field, payload) => {
    const { controller } = setup();
    await expect(controller.handleWebhook(payload, 'release')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('upserts the repository, creates the job and queues it', async () => {
    const { controller, prisma, queue } = setup();

    await expect(controller.handleWebhook(PAYLOAD, 'release')).resolves.toEqual({
      id: 'job-1',
      status: JobStatus.QUEUED,
      queued: true,
    });

    expect(prisma.repository.upsert).toHaveBeenCalledWith({
      where: { githubRepoId: 42n },
      create: { githubRepoId: 42n, fullName: 'acme/widgets', installationId: 7n },
      update: { fullName: 'acme/widgets', installationId: 7n },
    });
    expect(prisma.migrationJob.create).toHaveBeenCalledWith({
      data: {
        repositoryId: 'repo-1',
        dependencyName: 'react',
        targetVersion: 'v19.0.0',
        status: JobStatus.QUEUED,
      },
    });
    expect(queue.add).toHaveBeenCalledWith(
      MIGRATION_JOB_NAME,
      { jobId: 'job-1', repoUrl: 'https://github.com/acme/widgets.git' },
      RETRY_JOB_OPTIONS,
    );
  });

  it('falls back to the repository name and a github.com clone url', async () => {
    const { controller, prisma, queue } = setup();
    const payload = {
      ...PAYLOAD,
      release: { name: null, tag_name: 'v19.0.0' },
      repository: { id: 42, name: 'widgets', full_name: 'acme/widgets' },
    };

    await controller.handleWebhook(payload, 'release');

    expect(prisma.migrationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dependencyName: 'widgets' }) as unknown,
    });
    expect(queue.add).toHaveBeenCalledWith(
      MIGRATION_JOB_NAME,
      { jobId: 'job-1', repoUrl: 'https://github.com/acme/widgets.git' },
      RETRY_JOB_OPTIONS,
    );
  });

  it.each([JobStatus.QUEUED, JobStatus.IN_PROGRESS, JobStatus.COMPLETED])(
    'does not re-queue a redelivered release whose job is %s',
    async (status) => {
      const { controller, prisma, queue } = setup({ id: 'job-1', status });

      await expect(controller.handleWebhook(PAYLOAD, 'release')).resolves.toEqual({
        id: 'job-1',
        status,
        queued: false,
      });
      expect(prisma.migrationJob.findUniqueOrThrow).toHaveBeenCalledWith({
        where: {
          repositoryId_dependencyName_targetVersion: {
            repositoryId: 'repo-1',
            dependencyName: 'react',
            targetVersion: 'v19.0.0',
          },
        },
      });
      expect(queue.add).not.toHaveBeenCalled();
    },
  );

  it('re-queues a redelivered release whose job failed', async () => {
    const { controller, queue } = setup({ id: 'job-1', status: JobStatus.FAILED });

    await expect(controller.handleWebhook(PAYLOAD, 'release')).resolves.toEqual({
      id: 'job-1',
      status: JobStatus.QUEUED,
      queued: true,
    });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('rethrows database errors that are not a duplicate', async () => {
    const { controller, prisma, queue } = setup();
    prisma.migrationJob.create.mockRejectedValue(new Error('connection lost'));

    await expect(controller.handleWebhook(PAYLOAD, 'release')).rejects.toThrow('connection lost');
    expect(queue.add).not.toHaveBeenCalled();
  });
});
