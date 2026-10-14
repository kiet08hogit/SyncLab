import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { BullModule } from '@nestjs/bullmq';
import { MIGRATION_QUEUE } from '../common/constants';
import { MigrationJobsService } from './migration-jobs.service';
import { MigrationsController } from './migrations.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: MIGRATION_QUEUE,
    }),
  ],
  controllers: [WebhookController, MigrationsController],
  providers: [MigrationJobsService],
})
export class GatewayModule {}
