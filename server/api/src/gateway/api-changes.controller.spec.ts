import { BadRequestException } from '@nestjs/common';
import { ApiChangesController } from './api-changes.controller';

function setup() {
  const queries = {
    listProviders: jest.fn().mockResolvedValue([]),
    listChanges: jest.fn().mockResolvedValue([]),
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const controller = new ApiChangesController(queries as never, queue as never);
  return { controller, queries, queue };
}

describe('ApiChangesController', () => {
  it('passes valid filters through and leaves missing ones out', async () => {
    const { controller, queries } = setup();

    await controller.listChanges('anthropic', 'confirmed', 'model_retired');
    await controller.listChanges(undefined, '', undefined);

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
  ] as const)('rejects an unknown %s', (name, args) => {
    const { controller, queries } = setup();

    expect(() => controller.listChanges(...args)).toThrow(BadRequestException);
    expect(() => controller.listChanges(...args)).toThrow(new RegExp(`^${name} must be one of`));
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
});
