import { Module } from '@nestjs/common';
import { MigrationProcessor } from './migration.processor';

@Module({
  providers: [MigrationProcessor],
})
export class WorkerModule {}
