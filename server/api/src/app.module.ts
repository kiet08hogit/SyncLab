import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  configuration,
  roleIncludesGateway,
  roleIncludesWorker,
  type Configuration,
} from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { GithubModule } from './github/github.module';
import { GatewayModule } from './gateway/gateway.module';
import { WorkerModule } from './worker/worker.module';

const role = configuration().appRole;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    PrismaModule,
    GithubModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Configuration, true>) => ({
        connection: config.get('redis', { infer: true }),
      }),
    }),
    ...(roleIncludesGateway(role) ? [GatewayModule] : []),
    ...(roleIncludesWorker(role) ? [WorkerModule] : []),
  ],
})
export class AppModule {}
