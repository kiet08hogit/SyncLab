import { MetricsService, prometheus } from './metrics.service';

function setup() {
  const values: Record<string, string> = {};
  const transaction = {
    runCommand: jest.fn((_command: string, [key, field, value]: [string, string, number]) => {
      void key;
      values[field] = String(Number(values[field] ?? 0) + value);
      return undefined;
    }),
    exec: jest.fn().mockResolvedValue([[null, '1']]),
  };
  const client = { multi: () => transaction, hgetall: jest.fn(() => Promise.resolve(values)) };
  const queue = (name: string) => ({
    name,
    client: Promise.resolve(client),
    getJobCounts: jest.fn().mockResolvedValue({
      waiting: 2,
      active: 1,
      delayed: 3,
      failed: 4,
      paused: 5,
      'waiting-children': 6,
    }),
    isPaused: jest.fn().mockResolvedValue(true),
  });
  const queues = [
    queue('migration-queue'),
    queue('scan-queue'),
    queue('api-monitor-queue'),
  ] as const;
  const service = new MetricsService(...(queues.map((q) => q as never) as [never, never, never]));
  return { service, transaction, values };
}

describe('shared operations metrics', () => {
  it('accumulates cumulative latency buckets and failures across observations', async () => {
    const { service } = setup();
    await service.recordCreation(0.2, true);
    await service.recordCreation(2, false);
    const snapshot = await service.snapshot();
    expect(snapshot.sandbox).toMatchObject({ count: 2, failed: 1, totalSeconds: 2.2 });
    expect(snapshot.sandbox.buckets.map((b) => b.count)).toEqual([0, 1, 1, 1, 2, 2, 2, 2]);
    expect(snapshot.queues[0]).toMatchObject({ paused: true, pausedJobs: 5, waitingChildren: 6 });
    const text = prometheus(snapshot);
    expect(text).toContain('synclab_sandbox_creation_seconds_bucket{le="+Inf"} 2');
    expect(text).toContain('synclab_sandbox_creation_seconds_sum 2.2');
    expect(text).toContain('synclab_queue_jobs{queue="migration-queue",state="failed"} 4');
    expect(text).toContain('synclab_queue_paused{queue="migration-queue"} 1');
  });

  it('rejects nonnumeric, negative, fractional and excessive sandbox token values', async () => {
    const { service } = setup();
    for (const value of [-1, 1.5, Infinity, '8', 1e12]) {
      await service.recordTokens({ input: value, output: value, injected: 50 });
    }
    await service.recordTokens({ input: 140, output: 20 });
    await service.recordTokens({ input: 10, output: 5 });
    expect((await service.snapshot()).tokens).toEqual({ input: 150, output: 25 });
  });

  it('does not fail a sandbox operation when Redis rejects a telemetry write', async () => {
    const { service, transaction } = setup();
    transaction.exec.mockRejectedValue(new Error('Redis unavailable'));
    await expect(service.recordCreation(1, false)).resolves.toBeUndefined();
    await expect(service.recordTokens({ input: 1, output: 2 })).resolves.toBeUndefined();
  });

  it('bounds telemetry latency when the shared Redis client never becomes ready', async () => {
    jest.useFakeTimers();
    try {
      const queue = { client: new Promise(() => undefined) };
      const service = new MetricsService(queue as never, queue as never, queue as never);
      const recording = service.recordTokens({ input: 1, output: 2 });
      await jest.advanceTimersByTimeAsync(1000);
      await expect(recording).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns zero counters before workers have produced telemetry', async () => {
    expect((await setup().service.snapshot()).sandbox.count).toBe(0);
    expect((await setup().service.snapshot()).tokens).toEqual({ input: 0, output: 0 });
  });
});
