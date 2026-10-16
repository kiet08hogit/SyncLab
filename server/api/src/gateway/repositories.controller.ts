import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiAuthGuard, CurrentCaller, type Caller } from './api-auth.guard';
import { MigrationQueriesService } from './migration-queries.service';

@Controller('repositories')
@UseGuards(ApiAuthGuard)
export class RepositoriesController {
  constructor(private readonly queries: MigrationQueriesService) {}

  @Get()
  listRepositories(@CurrentCaller() caller: Caller) {
    return this.queries.listRepositories(caller);
  }
}
