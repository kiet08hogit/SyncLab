import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { BullModule } from '@nestjs/bullmq';
import { API_MONITOR_QUEUE, MIGRATION_QUEUE, SCAN_QUEUE } from '../common/constants';
import { MigrationJobsService } from './migration-jobs.service';
import { MigrationQueriesService } from './migration-queries.service';
import { MigrationsController } from './migrations.controller';
import { RepositoriesController } from './repositories.controller';
import { ScansService } from './scans.service';
import { ApiChangesController } from './api-changes.controller';
import { ApiChangesQueries } from '../monitor/api-changes.queries';

@Module({
  imports: [
    BullModule.registerQueue({
      name: MIGRATION_QUEUE,
    }),
    BullModule.registerQueue({
      name: SCAN_QUEUE,
    }),
    BullModule.registerQueue({
      name: API_MONITOR_QUEUE,
    }),
  ],
  controllers: [
    WebhookController,
    MigrationsController,
    RepositoriesController,
    ApiChangesController,
  ],
  providers: [MigrationJobsService, MigrationQueriesService, ScansService, ApiChangesQueries],
})
export class GatewayModule {}
