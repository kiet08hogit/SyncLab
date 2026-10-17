import {
  BadRequestException,
  Controller,
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
import { Queue } from 'bullmq';
import { API_MONITOR_JOB_NAME, API_MONITOR_QUEUE, BreakingChangeStatus } from '../common/constants';
import { ApiChangesQueries } from '../monitor/api-changes.queries';
import { ApiAuthGuard } from './api-auth.guard';

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
 * authenticated caller may read them.
 */
@Controller()
@UseGuards(ApiAuthGuard)
export class ApiChangesController {
  constructor(
    private readonly queries: ApiChangesQueries,
    @InjectQueue(API_MONITOR_QUEUE) private readonly queue: Queue,
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

  @Get('api-changes')
  listChanges(
    @Query('provider') provider?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
  ) {
    return this.queries.listChanges({
      provider: oneOf('provider', provider, PROVIDERS),
      status: oneOf('status', status, STATUSES),
      kind: oneOf('kind', kind, KINDS),
    });
  }

  /**
   * Changes read from release notes and changelogs start as detected and only
   * start migrations (Phase 8) once confirmed here.
   */
  @Post('api-changes/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@Param('id', ParseUUIDPipe) id: string) {
    return this.setStatus(id, BreakingChangeStatus.CONFIRMED);
  }

  @Post('api-changes/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  dismiss(@Param('id', ParseUUIDPipe) id: string) {
    return this.setStatus(id, BreakingChangeStatus.DISMISSED);
  }

  private async setStatus(id: string, status: BreakingChangeStatus) {
    const change = await this.queries.setStatus(id, status);
    if (!change) {
      throw new NotFoundException(`Breaking change ${id} was not found`);
    }
    return change;
  }
}
