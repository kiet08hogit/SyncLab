import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ImpactService } from './impact.service';

/** Fills impacts for changes confirmed before this worker started. */
@Injectable()
export class ImpactBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(ImpactBootstrap.name);

  constructor(private readonly impact: ImpactService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.impact.recomputeAll();
    this.logger.log('Recomputed impact for confirmed breaking changes');
  }
}
