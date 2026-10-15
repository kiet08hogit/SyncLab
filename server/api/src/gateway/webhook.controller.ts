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
import { GithubSignatureGuard } from './github-signature.guard';
import { MigrationJobsService } from './migration-jobs.service';
import type { GithubReleasePayload } from './webhook.types';

@Controller('webhook')
@UseGuards(GithubSignatureGuard)
export class WebhookController {
  constructor(private readonly migrationJobs: MigrationJobsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async handleWebhook(
    @Body() payload: GithubReleasePayload,
    @Headers('x-github-event') event?: string,
  ) {
    if (event === 'ping') {
      return { ok: true };
    }

    if (event !== 'release' || payload.action !== 'published') {
      return { ignored: true, reason: `event "${event ?? 'unknown'}" is not a published release` };
    }

    const repository = payload.repository;
    if (!repository?.id || !repository.full_name) {
      throw new BadRequestException('Payload is missing repository.id or repository.full_name');
    }

    const targetVersion = payload.release?.tag_name;
    if (!targetVersion) {
      throw new BadRequestException('Payload is missing release.tag_name');
    }

    const installationId = payload.installation?.id;
    if (!installationId) {
      throw new BadRequestException(
        'Payload is missing installation.id, so no GitHub App installation token can be issued',
      );
    }

    const dependencyName = payload.release?.name || repository.name || repository.full_name;

    return this.migrationJobs.enqueue({
      githubRepoId: BigInt(repository.id),
      fullName: repository.full_name,
      installationId: BigInt(installationId),
      repoUrl: repository.clone_url ?? `https://github.com/${repository.full_name}.git`,
      dependencyName,
      targetVersion,
    });
  }
}
