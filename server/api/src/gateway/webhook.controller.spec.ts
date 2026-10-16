import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JobStatus, MIGRATION_JOB_NAME } from '../common/constants';
import { MigrationJobsService } from './migration-jobs.service';
import { WebhookController } from './webhook.controller';
import type { GithubPullRequestPayload } from './webhook.types';

const PAYLOAD: GithubPullRequestPayload = {
  action: 'opened',
  pull_request: {
    number: 12,
    title: 'Bump react from 18.3.1 to 19.0.0',
    user: { login: 'dependabot[bot]', type: 'Bot' },
    head: { ref: 'dependabot/npm_and_yarn/react-19.0.0', repo: { full_name: 'acme/widgets' } },
  },
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

  it('ignores events that are not a dependency update pull request', async () => {
    const { controller, queue } = setup();
    await expect(controller.handleWebhook(PAYLOAD, 'release')).resolves.toMatchObject({
      ignored: true,
    });
    await expect(
      controller.handleWebhook({ ...PAYLOAD, action: 'closed' }, 'pull_request'),
    ).resolves.toMatchObject({ ignored: true });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each([
    ['repository', { ...PAYLOAD, repository: undefined }],
    ['installation', { ...PAYLOAD, installation: undefined }],
  ])('rejects an update missing %s', async (_field, payload) => {
    const { controller } = setup();
    // Without a repository the fork check cannot match, so pin it on the head.
    const withHead = {
      ...payload,
      pull_request: {
        ...PAYLOAD.pull_request,
        head: { ...PAYLOAD.pull_request!.head, repo: { full_name: payload.repository?.full_name } },
      },
    };
    await expect(controller.handleWebhook(withHead, 'pull_request')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('upserts the repository, creates the job and queues it', async () => {
    const { controller, prisma, queue } = setup();

    await expect(controller.handleWebhook(PAYLOAD, 'pull_request')).resolves.toEqual({
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
        targetVersion: '19.0.0',
        status: JobStatus.QUEUED,
      },
    });
    expect(queue.add).toHaveBeenCalledWith(
      MIGRATION_JOB_NAME,
      { jobId: 'job-1', repoUrl: 'https://github.com/acme/widgets.git' },
      RETRY_JOB_OPTIONS,
    );
  });

  it('falls back to a github.com clone url', async () => {
    const { controller, queue } = setup();
    const payload = {
      ...PAYLOAD,
      repository: { id: 42, name: 'widgets', full_name: 'acme/widgets' },
    };

    await controller.handleWebhook(payload, 'pull_request');

    expect(queue.add).toHaveBeenCalledWith(
      MIGRATION_JOB_NAME,
      { jobId: 'job-1', repoUrl: 'https://github.com/acme/widgets.git' },
      RETRY_JOB_OPTIONS,
    );
  });

  it.each([JobStatus.QUEUED, JobStatus.IN_PROGRESS, JobStatus.COMPLETED])(
    'does not re-queue a redelivered update whose job is %s',
    async (status) => {
      const { controller, prisma, queue } = setup({ id: 'job-1', status });

      await expect(controller.handleWebhook(PAYLOAD, 'pull_request')).resolves.toEqual({
        id: 'job-1',
        status,
        queued: false,
      });
      expect(prisma.migrationJob.findUniqueOrThrow).toHaveBeenCalledWith({
        where: {
          repositoryId_dependencyName_targetVersion: {
            repositoryId: 'repo-1',
            dependencyName: 'react',
            targetVersion: '19.0.0',
          },
        },
      });
      expect(queue.add).not.toHaveBeenCalled();
    },
  );

  it('re-queues a redelivered update whose job failed', async () => {
    const { controller, queue } = setup({ id: 'job-1', status: JobStatus.FAILED });

    await expect(controller.handleWebhook(PAYLOAD, 'pull_request')).resolves.toEqual({
      id: 'job-1',
      status: JobStatus.QUEUED,
      queued: true,
    });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('rethrows database errors that are not a duplicate', async () => {
    const { controller, prisma, queue } = setup();
    prisma.migrationJob.create.mockRejectedValue(new Error('connection lost'));

    await expect(controller.handleWebhook(PAYLOAD, 'pull_request')).rejects.toThrow(
      'connection lost',
    );
    expect(queue.add).not.toHaveBeenCalled();
  });
});
