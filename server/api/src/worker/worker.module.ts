import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MIGRATION_QUEUE } from '../common/constants';
import { MigrationProcessor } from './migration.processor';
import { DockerSandboxService } from './sandbox/docker-sandbox.service';

@Module({
  imports: [BullModule.registerQueue({ name: MIGRATION_QUEUE })],
  providers: [MigrationProcessor, DockerSandboxService],
})
export class WorkerModule {}
