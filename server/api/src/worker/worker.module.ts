import { Module } from '@nestjs/common';
import { MigrationProcessor } from './migration.processor';
import { DockerSandboxService } from './sandbox/docker-sandbox.service';

@Module({
  providers: [MigrationProcessor, DockerSandboxService],
})
export class WorkerModule {}
