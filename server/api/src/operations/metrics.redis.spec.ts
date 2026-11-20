import { execFileSync, spawnSync } from 'node:child_process';
import { Queue } from 'bullmq';
import { METRICS_KEY, MetricsService, prometheus } from './metrics.service';

const container = `synclab-ops-metrics-${process.pid}`;

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

function storedHash(): Record<string, string> {
  const lines = docker(['exec', container, 'redis-cli', 'HGETALL', METRICS_KEY])
    .split('\n')
    .filter(Boolean);
  const values: Record<string, string> = {};
  for (let index = 0; index < lines.length; index += 2) {
    values[lines[index]] = lines[index + 1];
  }
  return values;
}

jest.setTimeout(60_000);

describe('operations metrics persisted in Redis', () => {
  const queues: Queue[] = [];
  let port = 0;

  beforeAll(async () => {
    docker(['run', '-d', '--rm', '--name', container, '-p', '127.0.0.1::6379', 'redis:7']);
    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline) {
      const ping = spawnSync('docker', ['exec', container, 'redis-cli', 'PING'], {
        encoding: 'utf8',
      });
      if (ping.stdout.trim() === 'PONG') {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Redis did not become ready');
    port = Number(docker(['port', container, '6379/tcp']).split('\n')[0].split(':').at(-1));
  });

  afterAll(async () => {
    await Promise.all(queues.map((queue) => queue.close()));
    spawnSync('docker', ['rm', '-f', container]);
  });

  it('persists sandbox latency and token counters for the snapshot and Prometheus', async () => {
    const connection = { host: '127.0.0.1', port, maxRetriesPerRequest: 1 };
    const migrations = new Queue('migration-queue', { connection });
    const scans = new Queue('scan-queue', { connection });
    const monitor = new Queue('api-monitor-queue', { connection });
    queues.push(migrations, scans, monitor);
    const service = new MetricsService(migrations, scans, monitor);

    await service.recordCreation(0.2, true);
    await service.recordCreation(2, false);
    await service.recordTokens({ input: -1, output: 1.5, injected: 50 });
    await service.recordTokens({ input: 140, output: 20 });
    await service.recordTokens({ input: 10, output: 5 });

    expect(storedHash()).toMatchObject({
      creation_count: '2',
      creation_seconds: '2.2',
      creation_failed: '1',
      'creation_le_0.1': '0',
      'creation_le_0.25': '1',
      'creation_le_2.5': '2',
      tokens_input: '150',
      tokens_output: '25',
    });
    expect(storedHash().injected).toBeUndefined();

    const snapshot = await service.snapshot();
    expect(snapshot.sandbox).toMatchObject({ count: 2, failed: 1, totalSeconds: 2.2 });
    expect(snapshot.sandbox.buckets.map((bucket) => bucket.count)).toEqual([
      0, 1, 1, 1, 2, 2, 2, 2,
    ]);
    expect(snapshot.tokens).toEqual({ input: 150, output: 25 });
    const text = prometheus(snapshot);
    expect(text).toContain('synclab_sandbox_creation_seconds_bucket{le="+Inf"} 2');
    expect(text).toContain('synclab_sandbox_creation_seconds_sum 2.2');
    expect(text).toContain('synclab_sandbox_creation_seconds_count 2');
    expect(text).toContain('synclab_sandbox_creation_failures_total 1');
    expect(text).toContain('synclab_llm_tokens_total{direction="input"} 150');
    expect(text).toContain('synclab_llm_tokens_total{direction="output"} 25');
  });
});
