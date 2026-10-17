import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Caller } from './api-auth.guard';
import { ApiChangesController } from './api-changes.controller';

const SERVICE: Caller = { kind: 'service' };

function user(login: string): Caller {
  return { kind: 'user', login, repositories: new Map() };
}

function setup(monitorAdminLogins: string[] = ['octo-admin']) {
  const queries = {
    listProviders: jest.fn().mockResolvedValue([]),
    listChanges: jest.fn().mockResolvedValue([]),
    setStatus: jest.fn(),
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn(() => monitorAdminLogins) };
  const controller = new ApiChangesController(queries as never, queue as never, config as never);
  return { controller, queries, queue };
}

describe('ApiChangesController', () => {
  it('passes valid filters through and leaves missing ones out', async () => {
    const { controller, queries } = setup();

    await controller.listChanges(SERVICE, 'anthropic', 'confirmed', 'model_retired');
    await controller.listChanges(SERVICE, undefined, '', undefined);

    expect(queries.listChanges).toHaveBeenNthCalledWith(1, {
      provider: 'anthropic',
      status: 'confirmed',
      kind: 'model_retired',
    });
    expect(queries.listChanges).toHaveBeenNthCalledWith(2, {
      provider: undefined,
      status: undefined,
      kind: undefined,
    });
  });

  it.each([
    ['provider', ['google', undefined, undefined]],
    ['status', [undefined, 'approved', undefined]],
    ['kind', [undefined, undefined, 'model_deleted']],
  ] as const)('rejects an unknown %s', async (name, args) => {
    const { controller, queries } = setup();

    await expect(controller.listChanges(SERVICE, ...args)).rejects.toThrow(BadRequestException);
    await expect(controller.listChanges(SERVICE, ...args)).rejects.toThrow(
      new RegExp(`^${name} must be one of`),
    );
    expect(queries.listChanges).not.toHaveBeenCalled();
  });

  it('queues one manual poll under a fixed job id, so repeated requests collapse', async () => {
    const { controller, queue } = setup();

    await expect(controller.poll()).resolves.toEqual({ queued: true });
    await controller.poll();

    expect(queue.add).toHaveBeenCalledTimes(2);
    for (const [name, data, opts] of queue.add.mock.calls as Array<
      [string, object, { jobId: string }]
    >) {
      expect(name).toBe('poll-api-sources');
      expect(data).toEqual({});
      expect(opts.jobId).toBe('manual-poll');
    }
  });

  it.each([
    ['confirm', 'confirmed'],
    ['dismiss', 'dismissed'],
  ] as const)('lets the service caller %s a change and returns it', async (action, status) => {
    const { controller, queries } = setup();
    queries.setStatus.mockResolvedValue({ id: 'change-1', status });

    await expect(controller[action](SERVICE, 'change-1')).resolves.toEqual({
      id: 'change-1',
      status,
      canReview: true,
    });
    expect(queries.setStatus).toHaveBeenCalledWith('change-1', status);
  });

  it.each(['confirm', 'dismiss'] as const)(
    'lets a user listed in MONITOR_ADMIN_LOGINS %s, whatever the case of the login',
    async (action) => {
      const { controller, queries } = setup(['octo-admin']);
      queries.setStatus.mockResolvedValue({ id: 'change-1' });

      await expect(controller[action](user('octo-admin'), 'change-1')).resolves.toMatchObject({
        canReview: true,
      });
      await expect(controller[action](user('Octo-Admin'), 'change-1')).resolves.toMatchObject({
        canReview: true,
      });
      expect(queries.setStatus).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['confirm', 'dismiss'] as const)(
    'answers 403 when a user who is not an admin tries to %s',
    async (action) => {
      const { controller, queries } = setup(['octo-admin']);

      await expect(controller[action](user('octocat'), 'change-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(queries.setStatus).not.toHaveBeenCalled();
    },
  );

  it('makes no user an admin when MONITOR_ADMIN_LOGINS is empty', async () => {
    const { controller, queries } = setup([]);

    await expect(controller.confirm(user('octo-admin'), 'change-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(queries.setStatus).not.toHaveBeenCalled();
  });

  it('tells each caller whether it may review the changes it lists', async () => {
    const { controller, queries } = setup(['octo-admin']);
    queries.listChanges.mockResolvedValue([{ id: 'change-1' }]);

    await expect(controller.listChanges(SERVICE)).resolves.toEqual([
      { id: 'change-1', canReview: true },
    ]);
    await expect(controller.listChanges(user('OCTO-ADMIN'))).resolves.toEqual([
      { id: 'change-1', canReview: true },
    ]);
    await expect(controller.listChanges(user('octocat'))).resolves.toEqual([
      { id: 'change-1', canReview: false },
    ]);
  });

  it('answers 404 for a change that does not exist', async () => {
    const { controller, queries } = setup();
    queries.setStatus.mockResolvedValue(null);

    await expect(controller.confirm(SERVICE, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.dismiss(SERVICE, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
