import { Global, Module } from '@nestjs/common';
import { ImpactService } from './impact.service';

@Global()
@Module({
  providers: [ImpactService],
  exports: [ImpactService],
})
export class ImpactModule {}
