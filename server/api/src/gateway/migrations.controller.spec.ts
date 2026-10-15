import { BadRequestException } from '@nestjs/common';
import { MigrationsController } from './migrations.controller';

const REPO = {
  githubRepoId: 42n,
  installationId: 7n,
  fullName: 'Acme/Widgets',
  cloneUrl: 'https://github.com/Acme/Widgets.git',
};

function setup() {
  const github = { lookupRepository: jest.fn().mockResolvedValue(REPO) };
  const migrationJobs = {
    enqueue: jest.fn().mockResolvedValue({ id: 'job-1', status: 'QUEUED', queued: true }),
  };
  const controller = new MigrationsController(github as never, migrationJobs as never);
  return { controller, github, migrationJobs };
}

describe('MigrationsController', () => {
  it('looks up the repo and enqueues with GitHub canonical name and clone url', async () => {
    const { controller, github, migrationJobs } = setup();

    await expect(
      controller.createMigration({
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

    await expect(controller.createMigration(body)).rejects.toBeInstanceOf(BadRequestException);
    expect(github.lookupRepository).not.toHaveBeenCalled();
    expect(migrationJobs.enqueue).not.toHaveBeenCalled();
  });
});
