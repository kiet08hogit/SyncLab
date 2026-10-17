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
import { GithubTokenService } from '../github/github-token.service';
import { parseDependencyUpdate } from './dependency-update';
import { GithubSignatureGuard } from './github-signature.guard';
import { MigrationJobsService } from './migration-jobs.service';
import { parseScanTrigger, SCAN_EVENTS } from './scan-trigger';
import { ScansService, type EnqueueScanResult } from './scans.service';
import type { GithubWebhookPayload } from './webhook.types';

/**
 * Dependabot and Renovate already watch npm for every installed repository and
 * open a pull request per new version. SyncLab reacts to those pull requests,
 * so a migration starts exactly when a dependency the repository uses has a
 * new release. Installations and pushes to the default branch keep the API
 * usage registry current instead.
 */
@Controller('webhook')
@UseGuards(GithubSignatureGuard)
export class WebhookController {
  constructor(
    private readonly migrationJobs: MigrationJobsService,
    private readonly githubTokens: GithubTokenService,
    private readonly scans: ScansService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async handleWebhook(
    @Body() payload: GithubWebhookPayload,
    @Headers('x-github-event') event?: string,
  ) {
    if (event === 'ping') {
      return { ok: true };
    }

    if (SCAN_EVENTS.includes(event as (typeof SCAN_EVENTS)[number])) {
      return this.handleScanTrigger(event, payload);
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

    const declared = await this.githubTokens.declaresRootDependency(
      BigInt(installationId),
      repository.full_name,
      update.dependencyName,
    );
    if (!declared) {
      return {
        ignored: true,
        reason: `${update.dependencyName} is not declared in the root package.json of ${repository.full_name}`,
      };
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

  private async handleScanTrigger(event: string | undefined, payload: GithubWebhookPayload) {
    const trigger = parseScanTrigger(event, payload);
    if (trigger.kind === 'ignored') {
      return { ignored: true, reason: trigger.reason };
    }

    const scans: EnqueueScanResult[] = [];
    for (const repository of trigger.repositories) {
      scans.push(
        await this.scans.enqueue({
          ...repository,
          installationId: trigger.installationId,
          trigger: trigger.trigger,
        }),
      );
    }
    return { scans };
  }
}
