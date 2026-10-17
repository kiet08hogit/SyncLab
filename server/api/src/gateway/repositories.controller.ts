import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GithubTokenService } from '../github/github-token.service';
import { ScanTrigger } from '../common/constants';
import { ApiAuthGuard, CurrentCaller, type Caller } from './api-auth.guard';
import { MigrationQueriesService } from './migration-queries.service';
import { ScansService } from './scans.service';

const GITHUB_REPO_ID = /^[1-9]\d{0,18}$/;

@Controller('repositories')
@UseGuards(ApiAuthGuard)
export class RepositoriesController {
  constructor(
    private readonly queries: MigrationQueriesService,
    private readonly scans: ScansService,
    private readonly github: GithubTokenService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  listRepositories(@CurrentCaller() caller: Caller) {
    return this.queries.listRepositories(caller);
  }

  @Post(':githubRepoId/scan')
  @HttpCode(HttpStatus.ACCEPTED)
  async scan(@CurrentCaller() caller: Caller, @Param('githubRepoId') param: string) {
    const fullName = await this.accessibleFullName(caller, param);
    const repo = await this.github.lookupRepository(fullName);

    return this.scans.enqueue({
      githubRepoId: repo.githubRepoId,
      fullName: repo.fullName,
      installationId: repo.installationId,
      repoUrl: repo.cloneUrl,
      trigger: ScanTrigger.MANUAL,
    });
  }

  @Get(':githubRepoId/api-usage')
  async apiUsage(@CurrentCaller() caller: Caller, @Param('githubRepoId') param: string) {
    await this.accessibleFullName(caller, param);
    const usage = await this.scans.usageFor(BigInt(param));
    if (!usage) {
      throw new NotFoundException(`Repository ${param} has not been scanned`);
    }
    return usage;
  }

  /**
   * The same answer for a repository that does not exist and one the caller
   * cannot reach, so a user cannot probe for repositories outside their
   * installations. A service caller reaches the repositories SyncLab recorded.
   */
  private async accessibleFullName(caller: Caller, param: string): Promise<string> {
    const notFound = new NotFoundException(
      `Repository ${param} was not found or is not accessible`,
    );
    if (!GITHUB_REPO_ID.test(param)) {
      throw notFound;
    }

    const githubRepoId = BigInt(param);
    if (caller.kind === 'user') {
      const repository = caller.repositories.get(githubRepoId);
      if (!repository) {
        throw notFound;
      }
      return repository.fullName;
    }

    const recorded = await this.prisma.repository.findUnique({ where: { githubRepoId } });
    if (!recorded) {
      throw notFound;
    }
    return recorded.fullName;
  }
}
