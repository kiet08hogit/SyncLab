import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { API_MONITOR_JOB_NAME, API_MONITOR_QUEUE, BreakingChangeStatus } from '../common/constants';
import type { Configuration } from '../config/configuration';
import { ImpactService } from '../impact/impact.service';
import { ApiChangesQueries } from '../monitor/api-changes.queries';
import { ApiAuthGuard, CurrentCaller, type Caller } from './api-auth.guard';

const PROVIDERS = ['anthropic', 'openai'];
const STATUSES: string[] = Object.values(BreakingChangeStatus);
const KINDS = [
  'model_retired',
  'param_removed',
  'param_renamed',
  'param_now_required',
  'enum_value_removed',
  'endpoint_removed',
  'behavior_changed',
];

function oneOf(name: string, value: string | undefined, allowed: string[]): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!allowed.includes(value)) {
    throw new BadRequestException(`${name} must be one of ${allowed.join(', ')}`);
  }
  return value;
}

/**
 * Breaking changes are about a provider, not a repository, so any
 * authenticated caller may read them. Confirming or dismissing one changes
 * what every installation sees, so only an admin may: the service caller, or
 * a user listed in MONITOR_ADMIN_LOGINS. Each change carries canReview, so
 * the dashboard knows whether to offer it.
 */
@Controller()
@UseGuards(ApiAuthGuard)
export class ApiChangesController {
  constructor(
    private readonly queries: ApiChangesQueries,
    @InjectQueue(API_MONITOR_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Configuration, true>,
    private readonly impact: ImpactService,
  ) {}

  @Get('api-providers')
  listProviders() {
    return this.queries.listProviders();
  }

  /**
   * A fixed job ID means a poll already waiting or running absorbs further
   * requests instead of queueing more of them.
   */
  @Post('api-providers/poll')
  @HttpCode(HttpStatus.ACCEPTED)
  async poll() {
    await this.queue.add(
      API_MONITOR_JOB_NAME,
      {},
      { jobId: 'manual-poll', removeOnComplete: true, removeOnFail: true },
    );
    return { queued: true };
  }

  /** Repositories and files a change affects. A user only sees repositories they can reach. */
  @Get('api-changes/:id/impact')
  async getImpact(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    const impact = await this.impact.list(id, caller);
    if (!impact) {
      throw new NotFoundException(`Breaking change ${id} was not found`);
    }
    return impact;
  }

  @Get('api-changes')
  async listChanges(
    @CurrentCaller() caller: Caller,
    @Query('provider') provider?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
  ) {
    const filters = {
      provider: oneOf('provider', provider, PROVIDERS),
      status: oneOf('status', status, STATUSES),
      kind: oneOf('kind', kind, KINDS),
    };
    const canReview = this.isAdmin(caller);
    const changes = await this.queries.listChanges(filters);
    return changes.map((change) => ({ ...change, canReview }));
  }

  /**
   * Changes read from release notes and changelogs start as detected and only
   * start migrations (Phase 8) once confirmed here.
   */
  @Post('api-changes/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.setStatus(caller, id, BreakingChangeStatus.CONFIRMED);
  }

  @Post('api-changes/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  dismiss(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.setStatus(caller, id, BreakingChangeStatus.DISMISSED);
  }

  private async setStatus(caller: Caller, id: string, status: BreakingChangeStatus) {
    if (!this.isAdmin(caller)) {
      throw new ForbiddenException('Only a monitor admin may confirm or dismiss a breaking change');
    }
    const change = await this.queries.setStatus(id, status);
    if (!change) {
      throw new NotFoundException(`Breaking change ${id} was not found`);
    }
    await this.impact.recomputeChange(id);
    return { ...change, canReview: true };
  }

  private isAdmin(caller: Caller): boolean {
    return (
      caller.kind === 'service' ||
      this.config.get('monitorAdminLogins', { infer: true }).includes(caller.login.toLowerCase())
    );
  }
}
