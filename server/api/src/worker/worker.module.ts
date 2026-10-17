import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MIGRATION_QUEUE, SCAN_QUEUE } from '../common/constants';
import { MigrationProcessor } from './migration.processor';
import { ScanProcessor } from './scan.processor';
import { DockerSandboxService } from './sandbox/docker-sandbox.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: MIGRATION_QUEUE }),
    BullModule.registerQueue({ name: SCAN_QUEUE }),
  ],
  providers: [MigrationProcessor, ScanProcessor, DockerSandboxService],
})
export class WorkerModule {}
