import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'migration-queue',
    }),
  ],
  controllers: [WebhookController],
})
export class GatewayModule {}
