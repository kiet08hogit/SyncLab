import { Controller, ForbiddenException, Get, Header, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Configuration } from '../config/configuration';
import { MetricsService, prometheus } from '../operations/metrics.service';
import { ApiAuthGuard, CurrentCaller, type Caller } from './api-auth.guard';

@Controller()
@UseGuards(ApiAuthGuard)
export class OperationsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService<Configuration, true>,
  ) {}

  private authorize(caller: Caller): void {
    if (caller.kind === 'service') return;
    const operators = this.config.get('operationsAdminLogins', { infer: true });
    if (!operators.includes(caller.login.toLowerCase())) {
      throw new ForbiddenException('Operations metrics require an operations admin');
    }
  }

  @Get('operations')
  @Header('Cache-Control', 'no-store')
  snapshot(@CurrentCaller() caller: Caller) {
    this.authorize(caller);
    return this.metrics.snapshot();
  }

  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(@CurrentCaller() caller: Caller) {
    this.authorize(caller);
    return prometheus(await this.metrics.snapshot());
  }
}
