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
  UseGuards,
} from '@nestjs/common';
import { GithubTokenService } from '../github/github-token.service';
import { MigrationJobsService } from './migration-jobs.service';
import { MigrationsApiTokenGuard } from './migrations-api-token.guard';

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

@Controller('migrations')
@UseGuards(MigrationsApiTokenGuard)
export class MigrationsController {
  constructor(
    private readonly github: GithubTokenService,
    private readonly migrationJobs: MigrationJobsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async createMigration(@Body() body: CreateMigrationBody = {}) {
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
  async getMigration(@Param('id', ParseUUIDPipe) id: string) {
    const job = await this.migrationJobs.findDetail(id);
    if (!job) {
      throw new NotFoundException(`Migration job ${id} was not found`);
    }
    return job;
  }
}
