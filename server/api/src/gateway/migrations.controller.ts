import {
  BadRequestException,
  Body,
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
import { JobStatus } from '../common/constants';
import { GithubTokenService } from '../github/github-token.service';
import { ApiAuthGuard, CurrentCaller, type Caller } from './api-auth.guard';
import { MigrationJobsService } from './migration-jobs.service';
import { MAX_LIST_LIMIT, MigrationQueriesService } from './migration-queries.service';

export interface ListMigrationsQuery {
  status?: string;
  repo?: string;
  q?: string;
  limit?: string;
}

export interface CreateMigrationBody {
  repoFullName?: unknown;
  dependencyName?: unknown;
  targetVersion?: unknown;
}

// Also keeps the name safe to splice into a GitHub API path, which is why a
// "." or ".." segment is refused even though the characters are allowed.
const REPO_FULL_NAME = /^[\w.-]+\/[\w.-]+$/;
const DOT_SEGMENT = /(^|\/)\.{1,2}(\/|$)/;

// Column widths in prisma/schema.prisma.
const MAX_DEPENDENCY_NAME_LENGTH = 255;
const MAX_TARGET_VERSION_LENGTH = 50;

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${field} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new BadRequestException(`${field} must be at most ${maxLength} characters`);
  }
  return value.trim();
}

const JOB_STATUSES = Object.values(JobStatus) as string[];
const MAX_QUERY_LENGTH = 255;

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new BadRequestException(`limit must be an integer from 1 to ${MAX_LIST_LIMIT}`);
  }
  return limit;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > MAX_QUERY_LENGTH) {
    throw new BadRequestException(
      `${field} must be a string of at most ${MAX_QUERY_LENGTH} characters`,
    );
  }
  return value;
}

@Controller('migrations')
@UseGuards(ApiAuthGuard)
export class MigrationsController {
  constructor(
    private readonly github: GithubTokenService,
    private readonly migrationJobs: MigrationJobsService,
    private readonly queries: MigrationQueriesService,
  ) {}

  @Get()
  listMigrations(@CurrentCaller() caller: Caller, @Query() query: ListMigrationsQuery = {}) {
    if (query.status !== undefined && !JOB_STATUSES.includes(query.status)) {
      throw new BadRequestException(`status must be one of ${JOB_STATUSES.join(', ')}`);
    }
    return this.queries.listJobs(caller, {
      status: query.status as JobStatus | undefined,
      repoFullName: optionalString(query.repo, 'repo'),
      query: optionalString(query.q, 'q'),
      limit: parseLimit(query.limit),
    });
  }

  // Declared before :id so "counts" is not parsed as a job id.
  @Get('counts')
  countMigrations(@CurrentCaller() caller: Caller) {
    return this.queries.countByStatus(caller);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async createMigration(@CurrentCaller() caller: Caller, @Body() body: CreateMigrationBody = {}) {
    const repoFullName = requireString(body.repoFullName, 'repoFullName', 255);
    if (!REPO_FULL_NAME.test(repoFullName) || DOT_SEGMENT.test(repoFullName)) {
      throw new BadRequestException('repoFullName must look like "owner/repo"');
    }

    const dependencyName = requireString(
      body.dependencyName,
      'dependencyName',
      MAX_DEPENDENCY_NAME_LENGTH,
    );
    const targetVersion = requireString(
      body.targetVersion,
      'targetVersion',
      MAX_TARGET_VERSION_LENGTH,
    );

    const repo = await this.github.lookupRepository(repoFullName);
    // Same answer as a repository that does not exist, so a user cannot probe
    // for repositories outside their installations.
    if (caller.kind === 'user' && !caller.repositories.has(repo.githubRepoId)) {
      throw new NotFoundException(`Repository ${repoFullName} was not found or is not accessible`);
    }

    return this.migrationJobs.enqueue({
      githubRepoId: repo.githubRepoId,
      fullName: repo.fullName,
      installationId: repo.installationId,
      repoUrl: repo.cloneUrl,
      dependencyName,
      targetVersion,
    });
  }

  @Get(':id')
  async getMigration(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    const job = await this.queries.findDetail(caller, id);
    if (!job) {
      throw new NotFoundException(`Migration job ${id} was not found`);
    }
    return job;
  }
}
