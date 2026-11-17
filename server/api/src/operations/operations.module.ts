import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { API_MONITOR_QUEUE, MIGRATION_QUEUE, SCAN_QUEUE } from '../common/constants';
import { MetricsService } from './metrics.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: MIGRATION_QUEUE },
      { name: SCAN_QUEUE },
      { name: API_MONITOR_QUEUE },
    ),
  ],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class OperationsModule {}
