import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { parseDependencyUpdate } from './dependency-update';
import { GithubSignatureGuard } from './github-signature.guard';
import { MigrationJobsService } from './migration-jobs.service';
import type { GithubPullRequestPayload } from './webhook.types';

/**
 * Dependabot and Renovate already watch npm for every installed repository and
 * open a pull request per new version. SyncLab reacts to those pull requests,
 * so a migration starts exactly when a dependency the repository uses has a
 * new release.
 */
@Controller('webhook')
@UseGuards(GithubSignatureGuard)
export class WebhookController {
  constructor(private readonly migrationJobs: MigrationJobsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async handleWebhook(
    @Body() payload: GithubPullRequestPayload,
    @Headers('x-github-event') event?: string,
  ) {
    if (event === 'ping') {
      return { ok: true };
    }

    const update = parseDependencyUpdate(event, payload);
    if (update.kind === 'ignored') {
      return { ignored: true, reason: update.reason };
    }

    const repository = payload.repository;
    if (!repository?.id || !repository.full_name) {
      throw new BadRequestException('Payload is missing repository.id or repository.full_name');
    }

    const installationId = payload.installation?.id;
    if (!installationId) {
      throw new BadRequestException(
        'Payload is missing installation.id, so no GitHub App installation token can be issued',
      );
    }

    return this.migrationJobs.enqueue({
      githubRepoId: BigInt(repository.id),
      fullName: repository.full_name,
      installationId: BigInt(installationId),
      repoUrl: repository.clone_url ?? `https://github.com/${repository.full_name}.git`,
      dependencyName: update.dependencyName,
      targetVersion: update.targetVersion,
    });
  }
}
