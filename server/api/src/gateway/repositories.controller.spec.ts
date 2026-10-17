import { NotFoundException } from '@nestjs/common';
import { RepositoriesController } from './repositories.controller';
import type { Caller } from './api-auth.guard';

const SERVICE: Caller = { kind: 'service' };
const USER: Caller = {
  kind: 'user',
  login: 'ada',
  repositories: new Map([
    [7n, { githubRepoId: 7n, fullName: 'acme/api', installationId: 42n, private: true }],
  ]),
};

function setup() {
  const scans = {
    enqueue: jest.fn().mockResolvedValue({ id: 'scan-1', status: 'QUEUED', queued: true }),
    usageFor: jest.fn().mockResolvedValue({ fullName: 'acme/api', usages: [] }),
  };
  const github = {
    lookupRepository: jest.fn().mockResolvedValue({
      githubRepoId: 7n,
      fullName: 'acme/api',
      installationId: 42n,
      cloneUrl: 'https://github.com/acme/api.git',
    }),
  };
  const prisma = { repository: { findUnique: jest.fn().mockResolvedValue(null) } };
  const controller = new RepositoriesController(
    {} as never,
    scans as never,
    github as never,
    prisma as never,
  );
  return { controller, scans, github, prisma };
}

describe('RepositoriesController', () => {
  describe('POST :githubRepoId/scan', () => {
    it('queues a manual scan of a repository the user can reach', async () => {
      const { controller, scans, github } = setup();

      await expect(controller.scan(USER, '7')).resolves.toMatchObject({ queued: true });
      expect(github.lookupRepository).toHaveBeenCalledWith('acme/api');
      expect(scans.enqueue).toHaveBeenCalledWith({
        githubRepoId: 7n,
        fullName: 'acme/api',
        installationId: 42n,
        repoUrl: 'https://github.com/acme/api.git',
        trigger: 'manual',
      });
    });

    it('answers 404 for a repository the user cannot reach, as for one that does not exist', async () => {
      const { controller, scans } = setup();

      await expect(controller.scan(USER, '8')).rejects.toBeInstanceOf(NotFoundException);
      expect(scans.enqueue).not.toHaveBeenCalled();
    });

    it('lets a service caller scan a repository SyncLab has recorded, and only those', async () => {
      const { controller, scans, prisma } = setup();

      await expect(controller.scan(SERVICE, '7')).rejects.toBeInstanceOf(NotFoundException);

      prisma.repository.findUnique.mockResolvedValue({ fullName: 'acme/api' });
      await expect(controller.scan(SERVICE, '7')).resolves.toMatchObject({ queued: true });
      expect(scans.enqueue).toHaveBeenCalledTimes(1);
    });

    it('refuses an id that is not a GitHub repository id', async () => {
      const { controller, prisma } = setup();

      for (const id of ['abc', '0', '-1', '1.5', '99999999999999999999']) {
        await expect(controller.scan(SERVICE, id)).rejects.toBeInstanceOf(NotFoundException);
      }
      expect(prisma.repository.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('GET :githubRepoId/api-usage', () => {
    it('returns the registry for a reachable repository', async () => {
      const { controller, scans } = setup();

      await expect(controller.apiUsage(USER, '7')).resolves.toEqual({
        fullName: 'acme/api',
        usages: [],
      });
      expect(scans.usageFor).toHaveBeenCalledWith(7n);
    });

    it('answers 404 before reading the registry of a repository the user cannot reach', async () => {
      const { controller, scans } = setup();

      await expect(controller.apiUsage(USER, '8')).rejects.toBeInstanceOf(NotFoundException);
      expect(scans.usageFor).not.toHaveBeenCalled();
    });

    it('answers 404 for a reachable repository that was never scanned', async () => {
      const { controller, scans } = setup();
      scans.usageFor.mockResolvedValue(undefined);

      await expect(controller.apiUsage(USER, '7')).rejects.toThrow('has not been scanned');
    });
  });
});
