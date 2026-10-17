import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { BullModule } from '@nestjs/bullmq';
import { MIGRATION_QUEUE, SCAN_QUEUE } from '../common/constants';
import { MigrationJobsService } from './migration-jobs.service';
import { MigrationQueriesService } from './migration-queries.service';
import { MigrationsController } from './migrations.controller';
import { RepositoriesController } from './repositories.controller';
import { ScansService } from './scans.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: MIGRATION_QUEUE,
    }),
    BullModule.registerQueue({
      name: SCAN_QUEUE,
    }),
  ],
  controllers: [WebhookController, MigrationsController, RepositoriesController],
  providers: [MigrationJobsService, MigrationQueriesService, ScansService],
})
export class GatewayModule {}
