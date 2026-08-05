import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { BullModule } from '@nestjs/bullmq';
import { MIGRATION_QUEUE } from '../common/constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: MIGRATION_QUEUE,
    }),
  ],
  controllers: [WebhookController],
})
export class GatewayModule {}
