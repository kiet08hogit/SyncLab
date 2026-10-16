import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Caller } from './api-auth.guard';
import { MigrationsController } from './migrations.controller';

const REPO = {
  githubRepoId: 42n,
  installationId: 7n,
  fullName: 'Acme/Widgets',
  cloneUrl: 'https://github.com/Acme/Widgets.git',
};

const SERVICE: Caller = { kind: 'service' };

function userWith(...githubRepoIds: bigint[]): Caller {
  return {
    kind: 'user',
    login: 'octocat',
    repositories: new Map(
      githubRepoIds.map((id) => [
        id,
        { githubRepoId: id, fullName: 'Acme/Widgets', installationId: 7n, private: false },
      ]),
    ),
  };
}

function setup() {
  const github = { lookupRepository: jest.fn().mockResolvedValue(REPO) };
  const migrationJobs = {
    enqueue: jest.fn().mockResolvedValue({ id: 'job-1', status: 'QUEUED', queued: true }),
  };
  const queries = {
    listJobs: jest.fn().mockResolvedValue([]),
    countByStatus: jest.fn().mockResolvedValue({}),
    findDetail: jest.fn().mockResolvedValue(null),
  };
  const controller = new MigrationsController(
    github as never,
    migrationJobs as never,
    queries as never,
  );
  return { controller, github, migrationJobs, queries };
}

describe('MigrationsController', () => {
  it('looks up the repo and enqueues with GitHub canonical name and clone url', async () => {
    const { controller, github, migrationJobs } = setup();

    await expect(
      controller.createMigration(SERVICE, {
        repoFullName: 'acme/widgets',
        dependencyName: 'react',
        targetVersion: '19.0.0',
      }),
    ).resolves.toEqual({ id: 'job-1', status: 'QUEUED', queued: true });

    expect(github.lookupRepository).toHaveBeenCalledWith('acme/widgets');
    expect(migrationJobs.enqueue).toHaveBeenCalledWith({
      githubRepoId: 42n,
      fullName: 'Acme/Widgets',
      installationId: 7n,
      repoUrl: 'https://github.com/Acme/Widgets.git',
      dependencyName: 'react',
      targetVersion: '19.0.0',
    });
  });

  it.each([
    ['a missing body', undefined],
    ['a missing repoFullName', { dependencyName: 'react', targetVersion: '19.0.0' }],
    ['a non-string field', { repoFullName: 'acme/widgets', dependencyName: 1, targetVersion: '1' }],
    ['an empty field', { repoFullName: 'acme/widgets', dependencyName: ' ', targetVersion: '1' }],
    [
      'a repo without an owner',
      { repoFullName: 'widgets', dependencyName: 'r', targetVersion: '1' },
    ],
    [
      'a repo name that escapes the API path',
      { repoFullName: 'acme/../orgs/x', dependencyName: 'r', targetVersion: '1' },
    ],
    ['a dot segment', { repoFullName: 'acme/..', dependencyName: 'r', targetVersion: '1' }],
    [
      'a targetVersion longer than its column',
      { repoFullName: 'acme/widgets', dependencyName: 'r', targetVersion: '1'.repeat(51) },
    ],
  ])('rejects %s', async (_case, body) => {
    const { controller, github, migrationJobs } = setup();

    await expect(controller.createMigration(SERVICE, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(github.lookupRepository).not.toHaveBeenCalled();
    expect(migrationJobs.enqueue).not.toHaveBeenCalled();
  });

  it('returns a job with its repository and execution log', async () => {
    const { controller, queries } = setup();
    const detail = { id: 'job-1', repository: { fullName: 'acme/widgets' }, executionLogs: [] };
    queries.findDetail.mockResolvedValue(detail);

    await expect(controller.getMigration(SERVICE, 'job-1')).resolves.toBe(detail);
    expect(queries.findDetail).toHaveBeenCalledWith(SERVICE, 'job-1');
  });

  it('answers 404 for an unknown job', async () => {
    const { controller } = setup();

    await expect(controller.getMigration(SERVICE, 'job-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lets a user start a migration on a repository their installations reach', async () => {
    const { controller, migrationJobs } = setup();

    await controller.createMigration(userWith(42n), {
      repoFullName: 'acme/widgets',
      dependencyName: 'react',
      targetVersion: '19.0.0',
    });

    expect(migrationJobs.enqueue).toHaveBeenCalled();
  });

  it('answers 404 when a user starts a migration on a repository outside their installations', async () => {
    const { controller, migrationJobs } = setup();

    await expect(
      controller.createMigration(userWith(99n), {
        repoFullName: 'acme/widgets',
        dependencyName: 'react',
        targetVersion: '19.0.0',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(migrationJobs.enqueue).not.toHaveBeenCalled();
  });

  it('passes list filters through to the caller-scoped query', async () => {
    const { controller, queries } = setup();
    const caller = userWith(42n);

    await controller.listMigrations(caller, {
      status: 'FAILED',
      repo: 'acme/widgets',
      q: 'zod',
      limit: '20',
    });

    expect(queries.listJobs).toHaveBeenCalledWith(caller, {
      status: 'FAILED',
      repoFullName: 'acme/widgets',
      query: 'zod',
      limit: 20,
    });
  });

  it.each([
    ['an unknown status', { status: 'DONE' }],
    ['a non-numeric limit', { limit: 'ten' }],
    ['a limit above the maximum', { limit: '501' }],
    ['a zero limit', { limit: '0' }],
    ['a repeated query parameter', { q: ['a', 'b'] as unknown as string }],
  ])('rejects a list request with %s', (_case, query) => {
    const { controller, queries } = setup();

    expect(() => controller.listMigrations(SERVICE, query)).toThrow(BadRequestException);
    expect(queries.listJobs).not.toHaveBeenCalled();
  });

  it('counts jobs for the caller', async () => {
    const { controller, queries } = setup();
    const caller = userWith(42n);

    await controller.countMigrations(caller);

    expect(queries.countByStatus).toHaveBeenCalledWith(caller);
  });
});
