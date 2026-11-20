import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { API_MONITOR_QUEUE, MIGRATION_QUEUE, SCAN_QUEUE } from '../common/constants';

export const METRICS_KEY = 'synclab:operations:v1';
export const CREATION_BUCKETS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

type HashIncrement = {
  hincrbyfloat(key: string, field: string, increment: number): unknown;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
};

function hashIncrement(transaction: object): HashIncrement | undefined {
  const candidate = transaction as { hincrbyfloat?: unknown; exec?: unknown };
  if (typeof candidate.hincrbyfloat !== 'function' || typeof candidate.exec !== 'function') {
    return undefined;
  }
  return transaction as HashIncrement;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    @InjectQueue(MIGRATION_QUEUE) private readonly migrations: Queue,
    @InjectQueue(SCAN_QUEUE) private readonly scans: Queue,
    @InjectQueue(API_MONITOR_QUEUE) private readonly monitor: Queue,
  ) {}

  /** Atomic shared counters work across independent gateway and worker processes. */
  async recordCreation(seconds: number, ok: boolean): Promise<void> {
    await this.record({
      creation_count: 1,
      creation_seconds: seconds,
      creation_failed: ok ? 0 : 1,
      ...Object.fromEntries(
        CREATION_BUCKETS.map((bound) => [`creation_le_${bound}`, seconds <= bound ? 1 : 0]),
      ),
    });
  }

  async recordTokens(usage: unknown): Promise<void> {
    if (!usage || typeof usage !== 'object') return;
    const values = usage as Record<string, unknown>;
    const increments: Record<string, number> = {};
    for (const direction of ['input', 'output']) {
      const value = values[direction];
      // Protocol input comes from a sandbox. Never let it create labels or corrupt counters.
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1e9) {
        increments[`tokens_${direction}`] = value;
      }
    }
    if (Object.keys(increments).length) await this.record(increments);
  }

  private async record(increments: Record<string, number>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        (async () => {
          const client = await this.migrations.client;
          const transaction = hashIncrement(client.multi());
          if (!transaction) throw new Error('Metric write failed');
          for (const [field, value] of Object.entries(increments)) {
            transaction.hincrbyfloat(METRICS_KEY, field, value);
          }
          const results = await transaction.exec();
          if (!results || results.some(([error]) => error)) throw new Error('Metric write failed');
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Metric write timed out')), 1000);
        }),
      ]);
    } catch {
      // Observability must never fail or indefinitely stall a migration when Redis is unavailable.
      this.logger.warn('Could not persist operations metrics');
    } finally {
      clearTimeout(timer);
    }
  }

  async snapshot() {
    const [queues, values] = await Promise.all([
      Promise.all(
        [this.migrations, this.scans, this.monitor].map(async (queue) => {
          const [counts, paused] = await Promise.all([
            queue.getJobCounts(
              'waiting',
              'active',
              'delayed',
              'failed',
              'paused',
              'waiting-children',
            ),
            queue.isPaused(),
          ]);
          return {
            name: queue.name,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            failed: counts.failed ?? 0,
            pausedJobs: counts.paused ?? 0,
            waitingChildren: counts['waiting-children'] ?? 0,
            paused,
          };
        }),
      ),
      (await this.migrations.client).hgetall(METRICS_KEY),
    ]);
    const number = (key: string) => Number(values[key] ?? 0);
    return {
      collectedAt: new Date().toISOString(),
      queues,
      sandbox: {
        count: number('creation_count'),
        failed: number('creation_failed'),
        totalSeconds: number('creation_seconds'),
        buckets: CREATION_BUCKETS.map((le) => ({ le, count: number(`creation_le_${le}`) })),
      },
      tokens: { input: number('tokens_input'), output: number('tokens_output') },
    };
  }
}

export type OperationsSnapshot = Awaited<ReturnType<MetricsService['snapshot']>>;

export function prometheus(snapshot: OperationsSnapshot): string {
  const lines: string[] = [];
  const metric = (name: string, help: string, type: string) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
  };
  metric('synclab_queue_jobs', 'Jobs currently retained in each BullMQ queue by state.', 'gauge');
  for (const queue of snapshot.queues) {
    for (const [state, count] of Object.entries({
      waiting: queue.waiting,
      active: queue.active,
      delayed: queue.delayed,
      failed: queue.failed,
      paused: queue.pausedJobs,
      waiting_children: queue.waitingChildren,
    })) {
      lines.push(`synclab_queue_jobs{queue="${queue.name}",state="${state}"} ${count}`);
    }
  }
  metric('synclab_queue_paused', 'Whether a BullMQ queue is paused.', 'gauge');
  for (const queue of snapshot.queues) {
    lines.push(`synclab_queue_paused{queue="${queue.name}"} ${queue.paused ? 1 : 0}`);
  }
  metric(
    'synclab_sandbox_creation_seconds',
    'Docker container creation latency, including failed attempts.',
    'histogram',
  );
  for (const bucket of snapshot.sandbox.buckets) {
    lines.push(`synclab_sandbox_creation_seconds_bucket{le="${bucket.le}"} ${bucket.count}`);
  }
  lines.push(
    `synclab_sandbox_creation_seconds_bucket{le="+Inf"} ${snapshot.sandbox.count}`,
    `synclab_sandbox_creation_seconds_sum ${snapshot.sandbox.totalSeconds}`,
    `synclab_sandbox_creation_seconds_count ${snapshot.sandbox.count}`,
  );
  metric(
    'synclab_sandbox_creation_failures_total',
    'Failed Docker container creation attempts.',
    'counter',
  );
  lines.push(`synclab_sandbox_creation_failures_total ${snapshot.sandbox.failed}`);
  metric(
    'synclab_llm_tokens_total',
    'Provider-reported tokens from completed model replies.',
    'counter',
  );
  for (const [direction, count] of Object.entries(snapshot.tokens)) {
    lines.push(`synclab_llm_tokens_total{direction="${direction}"} ${count}`);
  }
  return lines.join('\n') + '\n';
}
