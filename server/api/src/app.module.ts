import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { GatewayModule } from './gateway/gateway.module';
import { WorkerModule } from './worker/worker.module';

@Module({
  imports: [
    PrismaModule,
    BullModule.forRoot({
      connection: {
        host: 'localhost',
        port: 6379,
      },
    }),
    GatewayModule,
    WorkerModule,
  ],
})
export class AppModule {}
