import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { API_MONITOR_QUEUE, MIGRATION_QUEUE, SCAN_QUEUE } from '../common/constants';
import { ImpactBootstrap } from '../impact/impact.bootstrap';
import { ApiMonitorService } from '../monitor/api-monitor.service';
import { ApiMonitorProcessor, ApiMonitorScheduler } from './api-monitor.processor';
import { MigrationProcessor } from './migration.processor';
import { ScanProcessor } from './scan.processor';
import { DockerSandboxService } from './sandbox/docker-sandbox.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: MIGRATION_QUEUE }),
    BullModule.registerQueue({ name: SCAN_QUEUE }),
    BullModule.registerQueue({ name: API_MONITOR_QUEUE }),
  ],
  providers: [
    MigrationProcessor,
    ScanProcessor,
    DockerSandboxService,
    ApiMonitorService,
    ApiMonitorProcessor,
    ApiMonitorScheduler,
    ImpactBootstrap,
  ],
})
export class WorkerModule {}
