import { ApiMonitorProcessor, ApiMonitorScheduler } from './api-monitor.processor';

function scheduler(apiMonitor: { enabled: boolean; intervalMs: number }) {
  const queue = {
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    removeJobScheduler: jest.fn().mockResolvedValue(true),
  };
  const config = { get: jest.fn().mockReturnValue(apiMonitor) };
  return { queue, scheduler: new ApiMonitorScheduler(queue as never, config as never) };
}

describe('ApiMonitorScheduler', () => {
  it('schedules the poll at the configured interval', async () => {
    const { queue, scheduler: s } = scheduler({ enabled: true, intervalMs: 3_600_000 });

    await s.onApplicationBootstrap();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'poll-api-sources',
      { every: 3_600_000 },
      expect.objectContaining({ name: 'poll-api-sources' }),
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it('removes a previously registered schedule when monitoring is disabled', async () => {
    const { queue, scheduler: s } = scheduler({ enabled: false, intervalMs: 3_600_000 });

    await s.onApplicationBootstrap();

    expect(queue.removeJobScheduler).toHaveBeenCalledWith('poll-api-sources');
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });
});

describe('ApiMonitorProcessor', () => {
  it('polls every source and returns what happened', async () => {
    const results = [{ sourceId: 's', url: 'u', changed: true, created: 2, updated: 0 }];
    const monitor = { pollAll: jest.fn().mockResolvedValue(results) };

    await expect(new ApiMonitorProcessor(monitor as never).process()).resolves.toBe(results);
  });
});
