import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { BullModule } from '@nestjs/bullmq';
import { MIGRATION_QUEUE } from '../common/constants';
import { MigrationJobsService } from './migration-jobs.service';
import { MigrationQueriesService } from './migration-queries.service';
import { MigrationsController } from './migrations.controller';
import { RepositoriesController } from './repositories.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: MIGRATION_QUEUE,
    }),
  ],
  controllers: [WebhookController, MigrationsController, RepositoriesController],
  providers: [MigrationJobsService, MigrationQueriesService],
})
export class GatewayModule {}
