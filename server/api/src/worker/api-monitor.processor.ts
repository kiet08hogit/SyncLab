import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { API_MONITOR_JOB_NAME, API_MONITOR_QUEUE } from '../common/constants';
import type { Configuration } from '../config/configuration';
import { ApiMonitorService, type PollResult } from '../monitor/api-monitor.service';

const SCHEDULER_ID = 'poll-api-sources';

/**
 * Polls every provider source. Concurrency 1, so the scheduled poll and a
 * manual one never run side by side in one worker.
 */
@Processor(API_MONITOR_QUEUE, { concurrency: 1 })
export class ApiMonitorProcessor extends WorkerHost {
  constructor(private readonly monitor: ApiMonitorService) {
    super();
  }

  async process(): Promise<PollResult[]> {
    return this.monitor.pollAll();
  }
}

/**
 * Registers the recurring poll when a worker starts. upsertJobScheduler is
 * idempotent, so every worker can do this without adding duplicate schedules.
 */
@Injectable()
export class ApiMonitorScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ApiMonitorScheduler.name);

  constructor(
    @InjectQueue(API_MONITOR_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Configuration, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { enabled, intervalMs } = this.config.get('apiMonitor', { infer: true });
    if (!enabled) {
      await this.queue.removeJobScheduler(SCHEDULER_ID);
      this.logger.log('API change monitoring is disabled (API_MONITOR_ENABLED=false)');
      return;
    }
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: intervalMs },
      { name: API_MONITOR_JOB_NAME, opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
    this.logger.log(`Polling provider sources every ${Math.round(intervalMs / 60000)} minutes`);
  }
}
