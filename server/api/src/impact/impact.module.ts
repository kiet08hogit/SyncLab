import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MIGRATION_QUEUE } from '../common/constants';
import { ApiMigrationsService } from './api-migrations.service';
import { ImpactService } from './impact.service';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: MIGRATION_QUEUE })],
  providers: [ImpactService, ApiMigrationsService],
  exports: [ImpactService, ApiMigrationsService],
})
export class ImpactModule {}
